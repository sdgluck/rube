import { type Services } from "@tinkerbell/composition";
import PQueue from "p-queue";
import type { PlexClient, PlexSection } from "@tinkerbell/plex";

import { displayTitle, ruleRowTitle, type JobContext } from "@tinkerbell/core";
import { and, eq, ne, sql } from "drizzle-orm";
import { collections as collectionsTable } from "@tinkerbell/db";

import {
  resolveCollectionPrefs,
  resolveCollectionSummary,
  resolvePresentation,
  resolveSortTitle,
  type PresentationConfig,
  type RuleConfig,
} from "@tinkerbell/contracts";
import { bufferLog } from "./log-buffer.ts";
import { reconcileMembership, type ExistingCollection } from "./reconcile.ts";
import { createTagLabels } from "./tag-labels.ts";

/**
 * How many collections may be committed at once. Each commit is five-odd
 * Plex round-trips (create, label, optional pin, poster upload, detail +
 * children for the local mirror), and a grouped rule can produce hundreds
 * of them — run one at a time, latency dominates the whole job.
 */
export const COMMIT_CONCURRENCY = 6;

/**
 * Module-scoped, so `COMMIT_CONCURRENCY` caps the writes one Plex server sees
 * *in total* rather than per rule. Rules run concurrently too, and a per-rule
 * queue would multiply the burst by the rule concurrency — which on a home
 * server is how you turn a generate run into a stalled Plex.
 */
const commitQueue = new PQueue({ concurrency: COMMIT_CONCURRENCY });

/**
 * One commit at a time per (section, title). Rules in a batch run
 * concurrently, and two that build the same name — Actors and Directors both
 * making "Quentin Tarantino" — would each look for the other in the mirror
 * before either had written it, and create two collections under one title.
 * Held from the title check until the new collection is in the mirror.
 */
const titleLocks = new Map<string, Promise<unknown>>();
function withTitleLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = titleLocks.get(key) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  const settled = next.catch(() => {});
  titleLocks.set(key, settled);
  void settled.then(() => {
    if (titleLocks.get(key) === settled) titleLocks.delete(key);
  });
  return next;
}

export interface CommitCollectionOptions {
  section: PlexSection;
  machineId: string;
  name: string;
  ratingKeys: string[];
  labels: string[];
  ruleType: string;
  /**
   * The collection this rule already owns under this name, if it has one.
   *
   * Present means reconcile: diff the membership and apply the difference,
   * rather than build a new collection over the corpse of the old one. Absent
   * means there is nothing to reconcile against and this is a genuine create.
   */
  existing?: ExistingCollection;
  /**
   * Set for a rule's own collections; absent for the cleanup queue shelf,
   * which belongs to no rule's presentation config and gets no summary.
   */
  ruleId?: string;
  ruleConfig?: RuleConfig;
  /**
   * A description the source itself supplied — TMDb ships an overview with
   * every franchise, and it outranks anything a template would assemble.
   */
  sourceSummary?: string;
  /**
   * The name people read, when the Plex title differs from it — a person's
   * copy of a row, whose title carries invisible per-person marks
   * (`personal-title.ts`). Summaries, sort titles and Kometa posters are looked
   * up by what the row is called, not by those marks. Defaults to `name`.
   */
  displayName?: string;
  /**
   * A person's copy rather than the rule's own collection. Its summary is
   * written when it is created and then left alone: the summary ledger is keyed
   * by the rule's row name, which the shared collection already answers for, so
   * consulting it here would skip every copy's summary as "already written".
   */
  personalCopy?: boolean;
}

export function createFinalizeCommand(deps: Services) {
  const { tagResolverFor } = createTagLabels(deps);
  const { collections, posters, db } = deps;

  /**
   * Whether another collection in the section already has this exact title.
   *
   * Plex keeps static membership as a tag named by the title, so a second
   * collection under a taken title is an empty shell whose films land in the
   * first — Actors and Directors both building "Quentin Tarantino" in Films
   * left nine empty shells in one night. Verified against a real Plex
   * (1.43.4): the shell lists its twin's films, adds to it go to the twin,
   * renaming it changes nothing, and only a title of its own keeps the sets
   * apart.
   *
   * Asked of the local mirror rather than Plex: `sync-collections` refreshes
   * it before `generate`, and every collection a run creates is upserted into
   * it as it goes, so a rule committed earlier tonight is already there.
   * Case-insensitive, because there is no telling which way Plex's tag match
   * leans and the cost of guessing wrong is an empty shelf.
   */
  function titleTakenElsewhere(sectionKey: string, title: string, exceptKey?: string): boolean {
    const conditions = [
      eq(collectionsTable.sectionId, sectionKey),
      sql`lower(${collectionsTable.title}) = lower(${title})`,
    ];
    if (exceptKey) conditions.push(ne(collectionsTable.plexRatingKey, exceptKey));
    return (
      db
        .select({ k: collectionsTable.plexRatingKey })
        .from(collectionsTable)
        .where(and(...conditions))
        .get() != null
    );
  }
  const { forgetCollections, getCollectionArtwork, recordCollectionArtwork, upsertCollectionByKey } = collections;
  const { fetchAutoPoster } = posters;

  /**
   * Bring one collection to the state the rule asked for: reconciled against what
   * is already there when this rule owns something under the name, built from
   * nothing when it doesn't, then described and mirrored locally.
   *
   * Pinning is deliberately not here. It used to be, because a freshly created
   * collection is unpinned and so the only question was whether to pin it. A
   * reconciled collection keeps whatever pin it had, which makes the question
   * "does the homepage match?" — one that can only be answered once every
   * collection is known. `reconcilePins` answers it at the end of the run.
   *
   * Returns the Plex collection key, or null if creation failed.
   *
   * Commits run concurrently, so this collection's log lines are buffered and
   * emitted as one block — otherwise six collections' progress braids together
   * and the job log becomes unreadable.
   */
  async function commitCollection(
    jobCtx: JobContext,
    client: PlexClient,
    opts: CommitCollectionOptions,
  ): Promise<string | null> {
    const { ctx, flush } = bufferLog(jobCtx);
    const { section, name, ratingKeys } = opts;
    const shown = opts.displayName ?? name;
    try {
      const lockKey = `${section.key}\u0000${displayTitle(name).toLowerCase()}`;
      return await withTitleLock(lockKey, () =>
        commitQueue.add(async () => {
          // Reconcile if this rule already owns a collection under this name. Only
          // falls through to a rebuild when the diff declines the job — a smart
          // collection, or churn past the point where removing items one at a time
          // costs more than one POST.
          // A personal copy's title is already its own; a rule's shared one may not be.
          const guardTitles = !opts.personalCopy && !!opts.ruleId;
          if (opts.existing) {
            const reconciled = await reconcileMembership(ctx, client, opts.existing, opts.machineId, ratingKeys, {
              titleShared:
                guardTitles && titleTakenElsewhere(section.key, opts.existing.title, opts.existing.ratingKey),
            });
            if (reconciled) {
              if (!opts.personalCopy) await applySummary(ctx, client, reconciled.ratingKey, opts);
              await applyCollectionPrefs(ctx, client, reconciled.ratingKey, opts);
              await upsertCollectionByKey(client, section, reconciled.ratingKey);
              return reconciled.ratingKey;
            }
            // Declined. The old collection has to go before its replacement is
            // built, or Plex keeps both under the same title.
            await client.deleteItem(opts.existing.ratingKey).catch(() => {});
            forgetCollections([opts.existing.ratingKey]);
          }

          const title = guardTitles && titleTakenElsewhere(section.key, name) ? ruleRowTitle(name, opts.ruleId!) : name;
          if (title !== name) {
            ctx.log(
              `"${shown}" is already the title of another collection in ${section.title} - giving this one a title of its own.`,
            );
          }
          ctx.log(`Creating "${shown}" (${ratingKeys.length} items)...`);

          const collectionKey = await client.createCollectionWithLabel(
            section.key,
            section.type,
            opts.machineId,
            title,
            ratingKeys,
            opts.labels,
          );
          if (!collectionKey) return null;

          await applySummary(ctx, client, collectionKey, opts);
          await applyCollectionPrefs(ctx, client, collectionKey, opts);
          await applyAutoPoster(ctx, client, opts, collectionKey);
          await upsertCollectionByKey(client, section, collectionKey);
          return collectionKey;
        }),
      );
    } finally {
      flush();
    }
  }

  /**
   * Write the deterministic summary, if the rule has one to write.
   *
   * Deliberately inline rather than deferred to `collection-art`: it is a single
   * PUT with no CPU behind it, and a collection that gains its description the
   * moment it is created is the whole difference the feature makes. The
   * expensive halves — LLM-written summaries and poster rendering — are what the
   * separate command exists for.
   */
  async function applySummary(
    ctx: JobContext,
    client: PlexClient,
    ratingKey: string,
    opts: CommitCollectionOptions,
  ): Promise<void> {
    if (!opts.ruleId) return;
    const presentation: PresentationConfig = resolvePresentation(opts.ruleConfig);

    const resolveTag = await tagResolverFor(client, opts.section.key, opts.ruleConfig?.smartFilter);
    const resolved = resolveCollectionSummary(presentation, {
      ruleType: opts.ruleType,
      collectionName: opts.displayName ?? opts.name,
      sectionType: opts.section.type,
      itemCount: opts.ratingKeys.length,
      sourceSummary: opts.sourceSummary,
      config: opts.ruleConfig,
      resolveTag,
    });
    if (!resolved) return;

    // A person's copy: written on creation only, without the ledger (see
    // `personalCopy`). Re-writing it every run would also undo a hand edit.
    if (opts.personalCopy) {
      try {
        await client.updateCollection(ratingKey, { summary: resolved.text });
      } catch (err) {
        ctx.log(`Summary update failed for "${opts.displayName ?? opts.name}":`, err);
      }
      return;
    }

    // A summary somebody edited by hand is theirs. `collection-art` is what
    // notices the edit and sets the lock; this is where the lock is honoured, so
    // the nightly run stops overwriting it from the very next run onward.
    const ledger = getCollectionArtwork(opts.ruleId, opts.name);
    if (ledger?.summaryLockedAt) {
      ctx.log(`Summary for "${opts.name}" was edited in Plex — leaving it alone.`);
      return;
    }

    // Unchanged since we last wrote it. Cheap to skip and worth skipping: under
    // delete-and-recreate every collection was new every night so this always had
    // to be written, and now the overwhelmingly common case is a collection whose
    // description is already exactly right.
    if (ledger?.summary === resolved.text) return;

    try {
      await client.updateCollection(ratingKey, { summary: resolved.text });
      recordCollectionArtwork(opts.ruleId, opts.name, { summary: resolved.text, summarySource: resolved.source });
    } catch (err) {
      // A description is a nicety; failing to set one must not fail the commit.
      ctx.log(`Summary update failed for "${opts.name}":`, err);
    }
  }

  /**
   * Apply the rule's Plex prefs — how the collection shows in the library, how
   * its contents are ordered, and where it sorts.
   *
   * Absent config means "leave it alone" rather than "reset to default", so a
   * rule never quietly overwrites a choice somebody made by hand in Plex. Like
   * the summary, a failure here is logged and swallowed: these are presentation
   * details, and losing a whole run's worth of collections over a rejected
   * prefs write would be a much worse outcome than a collection sorting wrong.
   */
  async function applyCollectionPrefs(
    ctx: JobContext,
    client: PlexClient,
    ratingKey: string,
    opts: CommitCollectionOptions,
  ): Promise<void> {
    const presentation = resolvePresentation(opts.ruleConfig);
    const prefs = resolveCollectionPrefs(presentation);
    const sortTitle = resolveSortTitle(presentation, opts.displayName ?? opts.name);
    if (!prefs && !sortTitle) return;

    try {
      if (prefs) await client.setCollectionPrefs(ratingKey, prefs);
      if (sortTitle) await client.updateCollection(ratingKey, { titleSort: sortTitle });
    } catch (err) {
      ctx.log(`Collection prefs failed for "${opts.displayName ?? opts.name}":`, err);
    }
  }

  /**
   * Best-effort poster upload from the Kometa default-images set. Failures
   * are logged but never fail the surrounding commit — coverage is patchy
   * by design and a missing poster shouldn't break a rule run.
   */
  async function applyAutoPoster(
    ctx: JobContext,
    client: PlexClient,
    opts: CommitCollectionOptions,
    ratingKey: string,
  ): Promise<void> {
    // A rule that generates its own artwork gets it from `collection-art`.
    // Uploading a Kometa poster here as well would mean two uploads per
    // collection per run, the second one silently replacing the first.
    if (resolvePresentation(opts.ruleConfig).poster !== "none") return;

    const name = opts.displayName ?? opts.name;
    const result = await fetchAutoPoster({ ruleType: opts.ruleType, collectionName: name });

    if ("buffer" in result) {
      try {
        await client.uploadPoster(ratingKey, result.buffer);
        const tag = result.fromCache ? "cached" : "fetched";
        ctx.log(`Poster (${tag}) applied to "${name}"`);
      } catch (err) {
        ctx.log(`Poster upload failed for "${name}":`, err);
      }
      return;
    }

    if (result.status === "missing") {
      ctx.log(`No Kometa poster for "${name}" (${result.url})`);
      return;
    }

    if (result.status === "error") {
      ctx.log(`Poster fetch failed for "${name}" (${result.url}):`, result.error);
    }
  }

  return { commitCollection };
}

/**
 * `collection-art` — give every opted-in rule's collections a poster, and the
 * ones whose logic is user-defined an LLM-written summary.
 *
 * Deliberately *not* part of the rule run. Rendering a poster is `sharp` work
 * — CPU and memory — and a rule producing 200 collections would turn a
 * two-minute rule run into a forty-minute one, inside the rule's `generate`
 * budget and holding the rule lock the whole time. Same reasoning that makes
 * `overlays` a separate command from the rule run.
 *
 * It reads the world rather than a hand-off queue: every run of a rule deletes
 * and recreates that rule's collections, so a rating key recorded at commit
 * time is stale within a day. Listing the rule's collections by label at run
 * time is both simpler and correct whenever this happens to run.
 */
import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import {
  errorMessage,
  getConfig,
  plexHealthCallback,
  type CollectionArtJobConfig,
  type JobContext,
} from "@tinkerbell/core";
import { getEnabledRules, type Rule } from "@tinkerbell/domain.rules";
import {
  artworkHash,
  getCollectionArtwork,
  recordCollectionArtwork,
  type CollectionArtworkRow,
} from "@tinkerbell/domain.collections";
import { isCleanupRule, resolvePresentation, type PresentationConfig, type RuleConfig } from "@tinkerbell/contracts";
import { parseRuleConfig } from "../generate/config.ts";
import { buildCollectionPoster, fetchMemberPosters, posterAlreadyUploaded } from "./poster.ts";
import { describeRuleFilter, llmSummaryUnavailable, SAMPLE_TITLES, writeLlmSummary } from "./summary.ts";

interface Totals {
  considered: number;
  postersUploaded: number;
  postersUnchanged: number;
  summariesWritten: number;
  summariesLocked: number;
  failures: number;
}

export default async function run(ctx: JobContext, config: CollectionArtJobConfig): Promise<void> {
  // Checked at the moment of work rather than at save time, so someone who
  // wants it to stop has one switch to flip instead of every rule to edit.
  if (getConfig("collection_art_enabled") === false) {
    ctx.log("Collection artwork is switched off in Settings → Appearance — nothing to do.");
    return;
  }

  const rules = selectRules(config);
  if (rules.length === 0) {
    ctx.log("No enabled rules have collection artwork or AI summaries turned on — nothing to do.");
    return;
  }

  const { client, sections } = await connectPlex(ctx, config.sections);
  if (sections.length === 0) {
    ctx.log("No matching Plex sections — nothing to do.");
    return;
  }

  // Checked once, up front: without a provider every LLM-summary rule fails
  // identically, and saying so once beats saying it per collection.
  const llmUnavailable = llmSummaryUnavailable();

  ctx.log(`tinkerbell collection-art`);
  ctx.log(`${rules.length} rule(s), ${sections.length} section(s).`);
  if (config.force) ctx.log("Force: re-rendering and re-uploading regardless of what the ledger says.");

  const totals: Totals = {
    considered: 0,
    postersUploaded: 0,
    postersUnchanged: 0,
    summariesWritten: 0,
    summariesLocked: 0,
    failures: 0,
  };

  let done = 0;
  for (const rule of rules) {
    ctx.signal.throwIfAborted();
    const ruleConfig = parseRuleConfig(rule);
    const presentation = withGlobalAccent(resolvePresentation(ruleConfig));
    ctx.log(
      `\n--- Rule: "${rule.name}" (${rule.type}) — poster: ${presentation.poster}, summary: ${presentation.summary} ---`,
    );

    for (const section of sections) {
      ctx.signal.throwIfAborted();
      let collections;
      try {
        collections = await client.getCollections(section.key, { label: `Rule:${rule.id}` });
      } catch (err) {
        totals.failures++;
        ctx.log(`Could not list collections in "${section.title}": ${errorMessage(err)}`);
        continue;
      }
      if (collections.length === 0) continue;
      ctx.log(`"${section.title}": ${collections.length} collection(s).`);

      // Serially, one collection at a time: each one decodes and composites
      // several images, and `sharp` is already multi-threaded internally.
      // Overlapping them would fight the same cores and multiply peak memory.
      for (const collection of collections) {
        ctx.signal.throwIfAborted();
        totals.considered++;
        try {
          await processCollection(ctx, client, {
            rule,
            ruleConfig,
            presentation,
            section,
            ratingKey: collection.ratingKey,
            name: collection.title,
            force: config.force ?? false,
            llmUnavailable,
            totals,
          });
        } catch (err) {
          // One collection's failure is one collection's — the next is
          // unrelated, and abandoning the rest would leave a library
          // half-presented with no way to tell which half.
          totals.failures++;
          ctx.log(`"${collection.title}" failed: ${errorMessage(err)}`);
        }
      }
    }

    done++;
    ctx.progress(done, rules.length, `Presented ${done}/${rules.length} rules`);
  }

  ctx.log(
    `\nDone. ${totals.considered} collection(s) considered — ` +
      `${totals.postersUploaded} poster(s) uploaded, ${totals.postersUnchanged} unchanged, ` +
      `${totals.summariesWritten} summary/summaries written, ${totals.summariesLocked} left alone (edited in Plex), ` +
      `${totals.failures} failure(s).`,
  );
}

interface CollectionWork {
  rule: Rule;
  ruleConfig: RuleConfig;
  presentation: PresentationConfig;
  section: PlexSection;
  ratingKey: string;
  name: string;
  force: boolean;
  llmUnavailable: string | null;
  totals: Totals;
}

async function processCollection(ctx: JobContext, client: PlexClient, work: CollectionWork): Promise<void> {
  const { rule, presentation, name, totals } = work;
  const ledger = getCollectionArtwork(rule.id, name);

  const detail = await client.getCollectionDetail(work.ratingKey);

  // The listing was already narrowed by label server-side; this checks the
  // answer. Everything below writes to somebody's Plex server, and a build
  // that ignored the filter would have us replacing the artwork on every
  // collection in the library — including ones a person made by hand.
  const wanted = `rule:${rule.id}`.toLowerCase();
  if (!detail.labels.some((label) => label.toLowerCase() === wanted)) {
    ctx.log(`Skipping "${name}" — it does not carry this rule's label.`);
    return;
  }

  const locked = noteUserEdit(ctx, rule.id, name, detail.summary, ledger);

  const members = await client.getCollectionChildren(work.ratingKey, { smart: detail.smart });

  if (presentation.summary === "llm" && !locked) {
    await applyLlmSummary(ctx, client, work, detail.summary, ledger, members);
  } else if (locked && presentation.summary !== "none") {
    totals.summariesLocked++;
  }

  if (presentation.poster === "none") return;

  const { buffers, keys } = await fetchMemberPosters(client, members, ctx.signal);
  const built = await buildCollectionPoster({
    presentation,
    title: name,
    subtitle: subtitleFor(members.length, work.section.type),
    memberPosters: buffers,
    memberPosterKeys: keys,
  });
  if (!built) return;

  if (!work.force && posterAlreadyUploaded(ledger, built.inputHash)) {
    totals.postersUnchanged++;
    return;
  }

  // Recorded before the first upload and never again: after we've replaced it,
  // what's on the collection is ours, and re-reading it would overwrite the
  // one piece of evidence "revert artwork" has to be honest with.
  const priorThumb = ledger?.posterUploadedAt ? ledger.priorThumb : (detail.thumb ?? "");

  await client.uploadPoster(work.ratingKey, built.buffer);
  recordCollectionArtwork(rule.id, name, {
    inputHash: built.inputHash,
    posterUploadedAt: Date.now(),
    priorThumb,
  });
  totals.postersUploaded++;
  ctx.log(`Poster (${built.template}, ${built.memberPostersUsed} member poster(s)) applied to "${name}".`);
}

/**
 * Notice a summary somebody edited in Plex, and stop writing that one.
 *
 * The comparison is against what *we* last wrote, not against emptiness: a
 * collection we've never described has nothing to protect, and a collection
 * still carrying our own sentence hasn't been touched. Anything else is a
 * person's writing, and overwriting it every night is the kind of thing that
 * makes people uninstall.
 */
function noteUserEdit(
  ctx: JobContext,
  ruleId: string,
  name: string,
  current: string,
  ledger: CollectionArtworkRow | undefined,
): boolean {
  if (ledger?.summaryLockedAt) return true;
  if (!ledger?.summary) return false;
  const live = current.trim();
  if (!live || live === ledger.summary.trim()) return false;

  recordCollectionArtwork(ruleId, name, { summaryLockedAt: Date.now() });
  ctx.log(`Summary for "${name}" was edited in Plex — Tinkerbell will stop writing it.`);
  return true;
}

async function applyLlmSummary(
  ctx: JobContext,
  client: PlexClient,
  work: CollectionWork,
  currentSummary: string,
  ledger: CollectionArtworkRow | undefined,
  members: Array<{ title: string }>,
): Promise<void> {
  if (work.llmUnavailable) return;

  // The cache key. A rule whose config hasn't changed keeps the summary it
  // was given — regenerating nightly would cost an API call per collection
  // per night to produce a differently-worded version of the same sentence.
  const configHash = artworkHash([work.rule.type, work.name, work.ruleConfig]);
  if (!work.force && ledger?.summarySource === "llm" && ledger.summaryConfigHash === configHash) {
    // Still make sure Plex has it — the collection is recreated every run.
    if (currentSummary.trim() === ledger.summary.trim()) return;
    await client.updateCollection(work.ratingKey, { summary: ledger.summary });
    work.totals.summariesWritten++;
    return;
  }

  let text: string;
  try {
    text = await writeLlmSummary({
      ruleName: work.rule.name,
      ruleType: work.rule.type,
      collectionName: work.name,
      filterText: describeRuleFilter(work.ruleConfig),
      sampleTitles: members.slice(0, SAMPLE_TITLES).map((m) => m.title),
      signal: ctx.signal,
    });
  } catch (err) {
    // The templated summary written at commit time is already on the
    // collection, so a provider outage costs the better wording, not the
    // description.
    ctx.log(`AI summary for "${work.name}" failed: ${errorMessage(err)}`);
    work.totals.failures++;
    return;
  }
  if (!text) return;

  await client.updateCollection(work.ratingKey, { summary: text });
  recordCollectionArtwork(work.rule.id, work.name, {
    summary: text,
    summarySource: "llm",
    summaryConfigHash: configHash,
  });
  work.totals.summariesWritten++;
  ctx.log(`AI summary written for "${work.name}".`);
}

/**
 * Apply the global accent to a rule that hasn't chosen one.
 *
 * Per-rule beats global beats derived-from-member-art. The global exists so a
 * whole library's generated posters can share one colour without editing forty
 * rules; leaving it unset keeps the per-collection derivation, which is what
 * makes a set look like it belongs to its films rather than to a theme.
 */
function withGlobalAccent(presentation: PresentationConfig): PresentationConfig {
  if (presentation.accentColor) return presentation;
  const global = getConfig("collection_art_default_accent")?.trim();
  return global ? { ...presentation, accentColor: global } : presentation;
}

/** "42 films" / "8 series" — the one fact a poster can state that a title can't. */
function subtitleFor(count: number, sectionType: string): string | undefined {
  if (count <= 0) return undefined;
  const noun = sectionType === "movie" ? "film" : sectionType === "show" ? "series" : "title";
  const plural = noun === "series" ? "series" : `${noun}s`;
  return `${count} ${count === 1 ? noun : plural}`;
}

/**
 * Rules this run has anything to do for: enabled, building collections (a
 * cleanup rule's shelf is never presented), and opted into a poster or an
 * AI-written summary. Templated summaries are written during the rule run, so
 * they are not on their own a reason to be here.
 */
function selectRules(config: CollectionArtJobConfig): Rule[] {
  const wanted = config.ruleIds?.length ? new Set(config.ruleIds) : null;
  return getEnabledRules().filter((rule) => {
    if (wanted && !wanted.has(rule.id)) return false;
    const ruleConfig = parseRuleConfig(rule);
    if (isCleanupRule(ruleConfig)) return false;
    const presentation = resolvePresentation(ruleConfig);
    return presentation.poster !== "none" || presentation.summary === "llm";
  });
}

async function connectPlex(
  ctx: JobContext,
  sectionFilter: string[] | undefined,
): Promise<{ client: PlexClient; sections: PlexSection[] }> {
  const url = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const token = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  if (!token) throw new Error("Plex token is required. Configure it in Settings.");

  const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
  ctx.log(`Server: ${url}`);

  let sections = await client.getSections();
  const configured = getConfig("global_plex_libraries");
  if (configured) sections = sections.filter((s) => configured.includes(s.title));
  if (sectionFilter?.length) {
    const wanted = sectionFilter.map((s) => s.trim().toLowerCase());
    sections = sections.filter((s) => wanted.includes(s.key) || wanted.includes(s.title.toLowerCase()));
  }
  return { client, sections };
}

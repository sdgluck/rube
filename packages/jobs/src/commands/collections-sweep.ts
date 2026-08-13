import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { plexHealthCallback, errorMessage, getConfig } from "@tinkerbell/core";
import { deleteCollection } from "@tinkerbell/domain.collections";
import { getRules } from "@tinkerbell/domain.rules";
import type { JobContext, CollectionsSweepJobConfig } from "@tinkerbell/core";

/**
 * Remove rule-generated collections that no run will ever clean up on its own.
 *
 * Rule runs are delete-then-recreate, and the delete is keyed on the
 * `Rule:<id>` label — so anything the label no longer reaches is invisible to
 * every future run and stays in Plex forever. Two ways that happens:
 *
 *   • Duplicates. Two overlapping runs of one rule both deleted before either
 *     created, so the section holds several same-title collections from the
 *     same rule. (The rule lock now prevents new ones — this clears the ones
 *     already on the server.)
 *   • Orphans. The rule behind the label was deleted, so nothing runs its
 *     cleanup pass again.
 *
 * Deliberately narrow, because this deletes real things off a Plex server:
 *
 *   • Only collections carrying a `Rule:<id>` label are considered at all.
 *     Hand-made collections, Kometa's, and anything Tinkerbell made outside a
 *     rule (Because You Watched, migrations) are never touched.
 *   • A rule that merely exists but is *disabled* still owns its collections.
 *     Turning a rule off is not a request to delete its output.
 *   • Within a duplicate group the newest survives — that's the one the most
 *     recent run produced, and the one the Collections page links the rule to.
 */
export default async function run(ctx: JobContext, config: CollectionsSweepJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

  if (!PLEX_TOKEN) {
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: ctx.signal,
    onHealth: plexHealthCallback,
  });

  const dryRun = config.dryRun ?? false;

  ctx.log(`tinkerbell collections-sweep`);
  ctx.log(`Server: ${PLEX_URL}`);
  if (dryRun) ctx.log(`DRY RUN — nothing will be deleted.`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  const sections = await resolveSections(client, config);
  ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

  const knownRuleIds = new Set(getRules().map((r) => r.id));

  const inventory = await takeInventory(ctx, client, sections);
  ctx.log(
    `Inspected ${inventory.inspected} collection(s); ${inventory.candidates.length} carry a rule label.` +
      (inventory.unattributed > 0
        ? ` ${inventory.unattributed} Tinkerbell collection(s) carry no rule label and were left alone.`
        : ""),
  );

  const { orphans, duplicates } = classify(inventory.candidates, knownRuleIds);
  const doomed = [...orphans, ...duplicates];

  if (doomed.length === 0) {
    ctx.log(`Nothing to clean up — no orphaned or duplicate rule collections found.`);
    return;
  }

  if (orphans.length > 0) {
    ctx.log(`\n${orphans.length} orphan(s) — the rule that made them no longer exists:`);
    for (const c of orphans) ctx.log(`  - "${c.title}" in ${c.sectionTitle} (${c.itemCount} items, rule ${c.ruleId})`);
  }
  if (duplicates.length > 0) {
    ctx.log(`\n${duplicates.length} duplicate(s) — an older copy of a collection the same rule still makes:`);
    for (const c of duplicates) {
      ctx.log(`  - "${c.title}" in ${c.sectionTitle} (${c.itemCount} items, added ${formatAdded(c.addedAt)})`);
    }
  }

  if (dryRun) {
    ctx.log(`\nDry run — would have deleted ${doomed.length} collection(s). Nothing was changed.`);
    return;
  }

  ctx.log(`\nDeleting ${doomed.length} collection(s)...`);
  let deleted = 0;
  const failed: string[] = [];
  for (let i = 0; i < doomed.length; i++) {
    const c = doomed[i];
    ctx.progress(i, doomed.length, `Deleting "${c.title}" (${i + 1}/${doomed.length})...`);
    try {
      // Also drops the local row + membership, so the Collections page is
      // right without waiting for the next sync.
      await deleteCollection(client, c.ratingKey);
      deleted++;
    } catch (err) {
      // A 403 is the server-wide "Allow media deletion" setting being off —
      // every subsequent delete would fail the same way, so stop and say so
      // rather than emitting one identical line per collection.
      if (errorMessage(err).includes("403")) throw err;
      failed.push(`"${c.title}" in ${c.sectionTitle}: ${errorMessage(err)}`);
    }
  }

  if (failed.length > 0) {
    ctx.log(`\n${failed.length} deletion(s) failed:`);
    for (const line of failed) ctx.log(`  - ${line}`);
  }
  ctx.progress(doomed.length, doomed.length, `Deleted ${deleted} collection(s)`);
  ctx.log(`\nDone — deleted ${deleted} of ${doomed.length} collection(s).`);
}

/** A Plex collection that carries a `Rule:<id>` label, with what we need to judge it. */
export interface Candidate {
  ratingKey: string;
  title: string;
  sectionId: string;
  sectionTitle: string;
  ruleId: string;
  addedAt: number;
  itemCount: number;
}

async function resolveSections(client: PlexClient, config: CollectionsSweepJobConfig): Promise<PlexSection[]> {
  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  if (!config.sections || config.sections.length === 0) return allSections;

  const names = config.sections.map((s) => s.trim().toLowerCase());
  const sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
  if (sections.length === 0) {
    throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
  }
  return sections;
}

/**
 * Walk every section's collections and pull the labels for each. The listing
 * endpoint doesn't carry labels, so this is one detail fetch per collection —
 * slow on a large server, which is why it reports progress.
 */
async function takeInventory(
  ctx: JobContext,
  client: PlexClient,
  sections: PlexSection[],
): Promise<{ candidates: Candidate[]; inspected: number; unattributed: number }> {
  const candidates: Candidate[] = [];
  let inspected = 0;
  let unattributed = 0;

  const listings: Array<{ section: PlexSection; ratingKeys: string[] }> = [];
  for (const section of sections) {
    const colls = await client.getCollections(section.key);
    listings.push({ section, ratingKeys: colls.map((c) => c.ratingKey) });
  }
  const total = listings.reduce((sum, l) => sum + l.ratingKeys.length, 0);

  for (const { section, ratingKeys } of listings) {
    for (const ratingKey of ratingKeys) {
      ctx.progress(inspected, total, `Inspecting ${section.title} (${inspected + 1}/${total})...`);
      inspected++;

      let detail;
      try {
        detail = await client.getCollectionDetail(ratingKey);
      } catch (err) {
        // A collection that vanished mid-walk needs no cleanup, and one we
        // can't read is one we must not judge.
        ctx.log(`Skipped ${ratingKey} in "${section.title}": ${errorMessage(err)}`);
        continue;
      }

      const ruleLabel = detail.labels.find((l) => l.startsWith("Rule:"));
      if (!ruleLabel) {
        if (detail.labels.includes("Tinkerbell")) unattributed++;
        continue;
      }

      candidates.push({
        ratingKey,
        title: detail.title,
        sectionId: section.key,
        sectionTitle: section.title,
        ruleId: ruleLabel.slice("Rule:".length),
        addedAt: detail.addedAt ?? 0,
        itemCount: detail.childCount,
      });
    }
  }

  return { candidates, inspected, unattributed };
}

/**
 * Split the candidates into what to delete. Orphans go first because they're
 * unconditional; duplicates are decided per (section, rule, title) group with
 * the newest member kept.
 */
export function classify(
  candidates: Candidate[],
  knownRuleIds: Set<string>,
): { orphans: Candidate[]; duplicates: Candidate[] } {
  const orphans: Candidate[] = [];
  const groups = new Map<string, Candidate[]>();

  for (const c of candidates) {
    if (!knownRuleIds.has(c.ruleId)) {
      orphans.push(c);
      continue;
    }
    // NUL as the separator: a title can contain any printable character,
    // so a colon- or pipe-joined key could collide across groups.
    const key = [c.sectionId, c.ruleId, c.title].join("\u0000");
    const bucket = groups.get(key) ?? [];
    bucket.push(c);
    groups.set(key, bucket);
  }

  const duplicates: Candidate[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    // Newest wins. Plex hands out rating keys in ascending order, so it
    // breaks ties on collections created within the same second — which is
    // exactly what two racing runs produce.
    const sorted = [...bucket].sort((a, b) => b.addedAt - a.addedAt || Number(b.ratingKey) - Number(a.ratingKey));
    duplicates.push(...sorted.slice(1));
  }

  return { orphans, duplicates };
}

function formatAdded(addedAt: number): string {
  if (!addedAt) return "unknown";
  return new Date(addedAt * 1000).toISOString().slice(0, 10);
}

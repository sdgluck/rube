/**
 * Where two rules disagree.
 *
 * Nothing in the engine arbitrates between rules. They ran in creation order,
 * every one of them believed it owned whatever it touched, and the three ways
 * that goes wrong are all silent — each rule reports a successful run, and the
 * result is decided by which happened to go first.
 *
 * So this names them, from what the rules have actually *done* rather than
 * from what their filters might theoretically select. Reading the produced
 * collections and the real cleanup queue means no false positives from two
 * rules that share a library and never touch the same item, which is the
 * usual case and would have made the whole feature noise.
 *
 * It reports; it does not resolve. The fix is a human decision — reorder
 * them, narrow one, or disable it — and a tool that silently picked would
 * just be an invisible precedence rule again.
 */
import { inArray } from "drizzle-orm";
import { cleanupCandidates, db, ruleCollectionMembers, rules } from "@tinkerbell/db";
import { ruleAction, type RuleConfig } from "@tinkerbell/contracts";

export type ConflictKind = "collection-name" | "metadata-field" | "cleanup-vs-collection";

export interface RuleConflict {
  kind: ConflictKind;
  /** The rules involved, in running order. */
  rules: Array<{ id: string; name: string }>;
  /** What they are fighting over — a collection title, a field, an item. */
  subject: string;
  /** One line, in the words the Rules page shows. */
  detail: string;
}

interface RuleRow {
  id: string;
  name: string;
  enabled: number;
  config: Record<string, unknown>;
  position: number;
  createdAt: number;
}

/** Running order: position, then creation. Matches `getRules`. */
function inRunningOrder(rows: RuleRow[]): RuleRow[] {
  return [...rows].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
}

/**
 * Two rules producing a collection of the same name.
 *
 * Plex allows it, so this fails silently and spectacularly: you get two
 * collections both called "Top Rated", each rebuilt nightly by a different
 * rule, and which one a user sees depends on the order they were made in.
 * Read from what the rules actually built, so two rules that merely *could*
 * collide are not reported until they do.
 */
function collectionNameConflicts(ordered: RuleRow[]): RuleConflict[] {
  const byId = new Map(ordered.map((r) => [r.id, r]));
  const members = db
    .select({
      ruleId: ruleCollectionMembers.ruleId,
      sectionKey: ruleCollectionMembers.sectionKey,
      collectionName: ruleCollectionMembers.collectionName,
    })
    .from(ruleCollectionMembers)
    .all();

  // Same name in the same section is the collision; the same name in two
  // different libraries is two different collections and entirely normal.
  // Keyed as a JSON pair rather than a joined string: nearly every collection
  // name contains a space, and the display name is carried in the value so it
  // never has to be parsed back out of the key.
  const owners = new Map<string, { displayName: string; ruleIds: Set<string> }>();
  for (const row of members) {
    if (!byId.has(row.ruleId)) continue;
    const key = JSON.stringify([row.sectionKey, row.collectionName.toLowerCase()]);
    const entry = owners.get(key) ?? { displayName: row.collectionName, ruleIds: new Set<string>() };
    entry.ruleIds.add(row.ruleId);
    owners.set(key, entry);
  }

  const conflicts: RuleConflict[] = [];
  for (const { displayName, ruleIds } of owners.values()) {
    if (ruleIds.size < 2) continue;
    const involved = ordered.filter((r) => ruleIds.has(r.id));
    conflicts.push({
      kind: "collection-name",
      rules: involved.map((r) => ({ id: r.id, name: r.name })),
      subject: displayName,
      detail: `Both build a collection called "${displayName}" in the same library. Plex allows two collections with one name, so you get two — and which one a user sees depends on the order they were built.`,
    });
  }
  return conflicts;
}

/** Every metadata field a rule writes: scalars set, and tags added or removed. */
function metadataFieldsWritten(config: RuleConfig): string[] {
  const action = ruleAction(config);
  if (action.kind !== "metadata") return [];
  return [
    ...Object.keys(action.set ?? {}),
    ...Object.keys(action.addTags ?? {}),
    ...Object.keys(action.removeTags ?? {}),
  ];
}

/**
 * Two metadata rules writing the same field in the same library.
 *
 * Unlike the other two this is predicted from config rather than observed,
 * because the observable version — the write ledger — only shows the loser
 * after the damage is done. Scoped to a shared library so two rules tidying
 * different sections are not reported.
 */
function metadataFieldConflicts(ordered: RuleRow[]): RuleConflict[] {
  const metadataRules = ordered
    .filter((r) => r.enabled === 1)
    .map((r) => ({ row: r, fields: metadataFieldsWritten(r.config as RuleConfig) }))
    .filter((r) => r.fields.length > 0);

  const sectionsOf = (row: RuleRow) => (row.config as RuleConfig).sections ?? [];

  const conflicts: RuleConflict[] = [];
  for (let i = 0; i < metadataRules.length; i++) {
    for (let j = i + 1; j < metadataRules.length; j++) {
      const a = metadataRules[i];
      const b = metadataRules[j];

      const aSections = sectionsOf(a.row);
      const bSections = sectionsOf(b.row);
      // An empty section list means "every library", so it overlaps anything.
      const sharesLibrary =
        aSections.length === 0 || bSections.length === 0 || aSections.some((s) => bSections.includes(s));
      if (!sharesLibrary) continue;

      const shared = a.fields.filter((f) => b.fields.includes(f));
      if (shared.length === 0) continue;

      conflicts.push({
        kind: "metadata-field",
        rules: [
          { id: a.row.id, name: a.row.name },
          { id: b.row.id, name: b.row.name },
        ],
        subject: shared.join(", "),
        detail: `Both write ${shared.join(", ")} on items in the same library. "${b.row.name}" runs second, so its value is the one that survives the night.`,
      });
    }
  }
  return conflicts;
}

/**
 * An item queued for deletion that a collection rule is currently featuring.
 *
 * The most expensive of the three to be wrong about, and the least visible:
 * the collection rule rebuilds happily every night right up until the file
 * disappears underneath it.
 */
function cleanupVsCollectionConflicts(ordered: RuleRow[]): RuleConflict[] {
  const byId = new Map(ordered.map((r) => [r.id, r]));

  const queued = db
    .select({
      ruleId: cleanupCandidates.ruleId,
      ratingKey: cleanupCandidates.ratingKey,
      title: cleanupCandidates.title,
      actionedAt: cleanupCandidates.actionedAt,
    })
    .from(cleanupCandidates)
    .all()
    .filter((c) => c.actionedAt == null);
  if (queued.length === 0) return [];

  // Only the destructive modes matter here: a rule that labels an item is not
  // in conflict with one that features it.
  const destructiveRuleIds = new Set(
    queued
      .map((q) => q.ruleId)
      .filter((id) => {
        const row = byId.get(id);
        if (!row || row.enabled !== 1) return false;
        const action = ruleAction(row.config as RuleConfig);
        return action.kind === "cleanup" && (action.mode === "delete" || action.mode === "unmonitor");
      }),
  );
  if (destructiveRuleIds.size === 0) return [];

  const members = db.select().from(ruleCollectionMembers).all();

  const conflicts: RuleConflict[] = [];
  for (const candidate of queued) {
    if (!destructiveRuleIds.has(candidate.ruleId)) continue;
    for (const member of members) {
      const owner = byId.get(member.ruleId);
      if (!owner || owner.id === candidate.ruleId || owner.enabled !== 1) continue;
      if (!member.members.some((m) => m.ratingKey === candidate.ratingKey)) continue;

      const cleanupRule = byId.get(candidate.ruleId);
      conflicts.push({
        kind: "cleanup-vs-collection",
        rules: [
          { id: candidate.ruleId, name: cleanupRule?.name ?? candidate.ruleId },
          { id: owner.id, name: owner.name },
        ],
        subject: candidate.title,
        detail: `"${candidate.title}" is queued for removal by "${cleanupRule?.name}" while "${owner.name}" is featuring it in "${member.collectionName}".`,
      });
      break;
    }
  }
  return conflicts;
}

/**
 * Every conflict currently detectable, most consequential first.
 *
 * Deletion outranks a metadata disagreement, which outranks two collections
 * sharing a name — that is the order in which they cost you something you
 * cannot get back.
 */
export function findRuleConflicts(): RuleConflict[] {
  const all = db.select().from(rules).all() as RuleRow[];
  const ordered = inRunningOrder(all);
  return [
    ...cleanupVsCollectionConflicts(ordered),
    ...metadataFieldConflicts(ordered),
    ...collectionNameConflicts(ordered),
  ];
}

/**
 * Rules whose running order is load-bearing.
 *
 * The Rules page tells the user, in as many words, that where two rules write
 * the same field the later one's value "is the one that survives the night".
 * The nightly batch then drained rules through a pool of three workers, so the
 * survivor was whichever *finished* last — a different claim, and not a stable
 * one. Rather than drop the promise, the batch runs these rules one at a time in
 * position order; everything else still interleaves.
 *
 * Config-derived, like `metadataFieldConflicts` itself: the observable version
 * only names the loser after the damage is done, and this has to be known before
 * the run starts.
 */
export function rulesWithOrderedWrites(): Set<string> {
  const all = db
    .select({
      id: rules.id,
      name: rules.name,
      enabled: rules.enabled,
      config: rules.config,
      position: rules.position,
      createdAt: rules.createdAt,
    })
    .from(rules)
    .all();
  const ids = new Set<string>();
  for (const conflict of metadataFieldConflicts(inRunningOrder(all))) {
    for (const rule of conflict.rules) ids.add(rule.id);
  }
  return ids;
}

/**
 * Rules already producing a collection of this name, ignoring one rule.
 *
 * For the wizard, which needs to warn *before* a rule exists and so cannot
 * use the observed-conflict path above. `excludeRuleId` keeps a rule being
 * edited from colliding with itself.
 */
export function rulesProducingCollectionNamed(
  name: string,
  excludeRuleId?: string,
): Array<{ id: string; name: string }> {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return [];
  const rows = db.select().from(ruleCollectionMembers).all();
  const ids = [
    ...new Set(
      rows.filter((r) => r.collectionName.toLowerCase() === trimmed && r.ruleId !== excludeRuleId).map((r) => r.ruleId),
    ),
  ];
  if (ids.length === 0) return [];
  return db.select({ id: rules.id, name: rules.name }).from(rules).where(inArray(rules.id, ids)).all();
}

/** Conflicts involving one rule — for its own row and its detail view. */
export function conflictsForRule(ruleId: string): RuleConflict[] {
  return findRuleConflicts().filter((c) => c.rules.some((r) => r.id === ruleId));
}

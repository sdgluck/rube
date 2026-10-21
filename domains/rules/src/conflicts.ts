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
import { cleanupCandidates, plexSections, ruleCollectionMembers, rules, type Db } from "@rube/db";
import { ruleAction, type RuleConfig } from "@rube/contracts";

export type ConflictKind = "collection-name" | "metadata-field" | "cleanup-vs-collection";

export interface RuleConflict {
  kind: ConflictKind;
  /** The rules involved, in running order. */
  rules: Array<{ id: string; name: string }>;
  /** What they are fighting over — a collection title, a field, an item. */
  subject: string;
  /** One line, in the words the Rules page shows. */
  detail: string;
  /**
   * The library it happens in, where there is exactly one — a collection name
   * only collides within a section. Lets the page say *where*, and link to
   * the duplicates themselves.
   */
  library?: { key: string; title: string };
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
 * `config.schedule.afterRules`, read without trusting the config.
 *
 * Deliberately not via `ruleConfigSchema`: a config that fails validation for an
 * unrelated reason would lose its ordering constraint, and losing an ordering
 * constraint is silent and produces a wrong shelf. Reading the one field
 * defensively fails in the safer direction.
 */
function afterRulesOf(config: Record<string, unknown>): string[] {
  const schedule = config?.schedule;
  if (!schedule || typeof schedule !== "object") return [];
  const after = (schedule as Record<string, unknown>).afterRules;
  return Array.isArray(after) ? after.filter((id): id is string => typeof id === "string") : [];
}

/** Does `a` come after `b` in running order? */
function runsAfter(a: RuleRow | undefined, b: RuleRow | undefined): boolean {
  if (!a || !b) return false;
  if (a.position !== b.position) return a.position > b.position;
  return a.createdAt > b.createdAt;
}

export interface ConflictsDeps {
  db: Db;
}
export function createConflicts(deps: ConflictsDeps) {
  const { db } = deps;

  /**
   * Two rules producing a collection of the same name.
   *
   * Plex allows it. Since `finalize` started giving the second one a title of
   * its own (`ruleRowTitle`) the two no longer pool their items, so this is no
   * longer data loss — but people still see two shelves that read the same,
   * with nothing to tell them apart, and that is still the admin's to resolve.
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
    const owners = new Map<string, { displayName: string; sectionKey: string; ruleIds: Set<string> }>();
    for (const row of members) {
      if (!byId.has(row.ruleId)) continue;
      const key = JSON.stringify([row.sectionKey, row.collectionName.toLowerCase()]);
      const entry = owners.get(key) ?? {
        displayName: row.collectionName,
        sectionKey: row.sectionKey,
        ruleIds: new Set<string>(),
      };
      entry.ruleIds.add(row.ruleId);
      owners.set(key, entry);
    }

    // A section that has since vanished from the index still gets named, by
    // key — "in library 7" beats dropping the where entirely.
    const sectionTitles = new Map(
      db
        .select({ key: plexSections.key, title: plexSections.title })
        .from(plexSections)
        .all()
        .map((s) => [s.key, s.title]),
    );

    const conflicts: RuleConflict[] = [];
    for (const { displayName, sectionKey, ruleIds } of owners.values()) {
      if (ruleIds.size < 2) continue;
      const involved = ordered.filter((r) => ruleIds.has(r.id));
      conflicts.push({
        kind: "collection-name",
        rules: involved.map((r) => ({ id: r.id, name: r.name })),
        subject: displayName,
        library: { key: sectionKey, title: sectionTitles.get(sectionKey) ?? `library ${sectionKey}` },
        detail: `Both build a collection called "${displayName}" in the same library. Their items are kept apart, but people see two collections that read the same and can't tell which is which. Rename one rule's collections, or narrow one rule so only the other builds it.`,
      });
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
  function findRuleConflicts(): RuleConflict[] {
    const all = db.select().from(rules).all() as RuleRow[];
    const ordered = inRunningOrder(all);
    return [
      ...cleanupVsCollectionConflicts(ordered),
      ...metadataFieldConflicts(ordered),
      ...collectionNameConflicts(ordered),
    ];
  }

  /**
   * The rules whose order the batch has to respect, and the order itself.
   *
   * Two independent constraints, unioned because the batch can only honour them
   * with one mechanism — running the constrained rules one at a time:
   *
   * - **Same field, two writers.** The Rules page tells the user, in as many
   *   words, that where two rules write the same field the later one's value "is
   *   the one that survives the night". The batch drains rules through a pool of
   *   three workers, which made the survivor whichever *finished* last — a
   *   different claim, and not a stable one. Position order decides instead.
   * - **`afterRules`.** A rule that curates a pool another rule builds. This was
   *   honoured everywhere *except* the nightly batch: `runChain` fires for a cron
   *   or a trigger, but `runBatch` never calls it, on the reasoning that the batch
   *   runs every enabled rule anyway. True, and beside the point — it runs them
   *   three at a time, so the curate rule routinely read a pool that was still
   *   being rebuilt. The dependency was expressible, documented, and silently
   *   ignored in the one configuration every rule starts in.
   *
   * Returns a rank rather than a sorted list because the caller has its own
   * subset — one batch job owns collection rules, another owns cleanup — and a
   * rank survives filtering while a list does not.
   */
  function rulesRequiringOrder(): { ids: Set<string>; rank: Map<string, number> } {
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
    const ordered = inRunningOrder(all).filter((row) => row.enabled);
    const byId = new Map(ordered.map((row) => [row.id, row]));

    const ids = new Set<string>();
    for (const conflict of metadataFieldConflicts(ordered)) {
      for (const rule of conflict.rules) ids.add(rule.id);
    }

    // `after` → the rules that must follow it.
    const followers = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    for (const row of ordered) {
      for (const after of afterRulesOf(row.config)) {
        // An edge to a rule that is disabled or deleted is not a constraint —
        // nothing is going to run and satisfy it, and treating it as one would
        // strand the dependent rule in the sequential lane forever.
        if (after === row.id || !byId.has(after)) continue;
        followers.set(after, [...(followers.get(after) ?? []), row.id]);
        indegree.set(row.id, (indegree.get(row.id) ?? 0) + 1);
        ids.add(after);
        ids.add(row.id);
      }
    }

    // Kahn's, walking `ordered` so ties break on position then creation — the
    // same running order everything else here uses, and stable night to night.
    const rank = new Map<string, number>();
    const constrained = ordered.filter((row) => ids.has(row.id));
    const ready = constrained.filter((row) => (indegree.get(row.id) ?? 0) === 0).map((row) => row.id);
    while (ready.length > 0) {
      const id = ready.shift() as string;
      rank.set(id, rank.size);
      for (const follower of followers.get(id) ?? []) {
        const remaining = (indegree.get(follower) ?? 0) - 1;
        indegree.set(follower, remaining);
        if (remaining === 0) {
          // Re-inserted in running order rather than appended, so a rule freed by
          // an early dependency doesn't jump ahead of one freed later but ordered
          // sooner.
          const at = ready.findIndex((other) => runsAfter(byId.get(other), byId.get(follower)));
          if (at === -1) ready.push(follower);
          else ready.splice(at, 0, follower);
        }
      }
    }

    // Anything left is in a cycle. `afterRules` can be edited into one from either
    // end, so this is a real state rather than a corrupt one — the runtime has
    // always broken cycles rather than rejecting them (see MAX_CHAIN_DEPTH). Fall
    // back to running order for those, which is at least deterministic.
    for (const row of constrained) {
      if (!rank.has(row.id)) rank.set(row.id, rank.size);
    }

    return { ids, rank };
  }

  /**
   * Rules already producing a collection of this name, ignoring one rule.
   *
   * For the wizard, which needs to warn *before* a rule exists and so cannot
   * use the observed-conflict path above. `excludeRuleId` keeps a rule being
   * edited from colliding with itself.
   */
  function rulesProducingCollectionNamed(name: string, excludeRuleId?: string): Array<{ id: string; name: string }> {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return [];
    const rows = db.select().from(ruleCollectionMembers).all();
    const ids = [
      ...new Set(
        rows
          .filter((r) => r.collectionName.toLowerCase() === trimmed && r.ruleId !== excludeRuleId)
          .map((r) => r.ruleId),
      ),
    ];
    if (ids.length === 0) return [];
    return db.select({ id: rules.id, name: rules.name }).from(rules).where(inArray(rules.id, ids)).all();
  }

  /** Conflicts involving one rule — for its own row and its detail view. */
  function conflictsForRule(ruleId: string): RuleConflict[] {
    return findRuleConflicts().filter((c) => c.rules.some((r) => r.id === ruleId));
  }

  return { findRuleConflicts, rulesRequiringOrder, rulesProducingCollectionNamed, conflictsForRule };
}

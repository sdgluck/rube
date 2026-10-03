/**
 * Folding the conflict list into one entry per disagreement.
 *
 * The server reports one conflict per colliding collection name, which is the
 * right grain for detection and the wrong one for reading: two rules that both
 * build a streaming-service shelf collide on every service, and the banner
 * listed 25 identical sentences without once saying which rules were involved.
 * The fix for all 25 is one decision about two rules, so they read as one entry
 * naming those rules, with the colliding names underneath.
 */

export interface ConflictLike {
  kind: string;
  rules: Array<{ id: string; name: string }>;
  subject: string;
  detail: string;
  library?: { key: string; title: string };
}

export interface ConflictGroup {
  key: string;
  kind: string;
  /** In running order — the server lists them that way. */
  rules: Array<{ id: string; name: string }>;
  library?: { key: string; title: string };
  /** What they collide on: collection names, fields, items. */
  subjects: string[];
  /** The server's sentence for each, for kinds that don't merge. */
  details: string[];
}

/**
 * Only collection-name conflicts merge. The others each describe a different
 * item or field in a sentence of their own, and merging those would lose it.
 */
export function groupConflicts(conflicts: readonly ConflictLike[]): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>();
  conflicts.forEach((c, i) => {
    const key =
      c.kind === "collection-name"
        ? JSON.stringify([c.kind, c.rules.map((r) => r.id), c.library?.key ?? null])
        : JSON.stringify([c.kind, i]);
    const group = groups.get(key);
    if (group) {
      group.subjects.push(c.subject);
      group.details.push(c.detail);
    } else {
      groups.set(key, {
        key,
        kind: c.kind,
        rules: c.rules,
        library: c.library,
        subjects: [c.subject],
        details: [c.detail],
      });
    }
  });
  return [...groups.values()];
}

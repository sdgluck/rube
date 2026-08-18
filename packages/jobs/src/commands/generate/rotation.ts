/**
 * Homepage pin rotation.
 *
 * A rule like "By Director" can produce hundreds of collections; pinning all
 * of them buries the Plex home. Instead the rule can pin a fixed number per
 * library and rotate a fresh set in on every run.
 *
 * Rotation is keyed by collection NAME, not rating key. That was once forced —
 * every run deleted and recreated the rule's collections, so keys were new each
 * time — and is now merely right: a name ("Steven Spielberg") is what the
 * rotation is actually about, and survives a collection being rebuilt when its
 * membership churns past the reconcile threshold.
 */

export interface RotationCandidate {
  sectionKey: string;
  name: string;
  ratingKey: string;
}

/**
 * Whether a collection is substantial enough to earn a homepage row.
 *
 * `pinMinItems` is off by default (0 or absent), in which case everything the
 * rule pins is pinned. It gates *pinning only* — the collection is created
 * either way — so a grouped rule can keep building its long tail while the
 * home shows just the rows with something in them.
 */
export function meetsPinFloor(itemCount: number, pinMinItems: number): boolean {
  return pinMinItems <= 0 || itemCount >= pinMinItems;
}

/**
 * Pick `count` candidates per section, preferring ones that weren't pinned
 * last run so consecutive rotations don't overlap. Within each group the
 * order is random, so which collections surface varies run to run rather
 * than cycling in a fixed sequence.
 *
 * When a section has fewer than `count` unpinned candidates, the remainder is
 * topped up from the previously-pinned ones — a section with 12 collections
 * and a count of 10 still pins 10, it just can't avoid repeating 8 of them.
 */
export function selectRotation(
  candidates: RotationCandidate[],
  count: number,
  previous: Record<string, string[]>,
  shuffle: <T>(items: T[]) => T[] = shuffleInPlace,
): RotationCandidate[] {
  const bySection = new Map<string, RotationCandidate[]>();
  for (const candidate of candidates) {
    const bucket = bySection.get(candidate.sectionKey) ?? [];
    bucket.push(candidate);
    bySection.set(candidate.sectionKey, bucket);
  }

  const selected: RotationCandidate[] = [];
  for (const [sectionKey, sectionCandidates] of bySection) {
    const pinnedLastRun = new Set(previous[sectionKey] ?? []);
    const fresh = shuffle(sectionCandidates.filter((c) => !pinnedLastRun.has(c.name)));
    const repeats = shuffle(sectionCandidates.filter((c) => pinnedLastRun.has(c.name)));
    selected.push(...fresh.slice(0, count));
    if (fresh.length < count) {
      selected.push(...repeats.slice(0, count - fresh.length));
    }
  }
  return selected;
}

/** The `lastPinnedCollections` value to persist for a completed rotation. */
export function rotationState(selected: RotationCandidate[]): Record<string, string[]> {
  const state: Record<string, string[]> = {};
  for (const { sectionKey, name } of selected) {
    (state[sectionKey] ??= []).push(name);
  }
  return state;
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

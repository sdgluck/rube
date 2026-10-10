/**
 * Does Plex number this show's episodes the way Sonarr does?
 *
 * Asked by comparing *titles*, not counts or filenames. Plex places a file by
 * the `SxxEyy` in its name whatever ordering the show uses, so the filename
 * always agrees with Plex's index and tells you nothing; the episode Plex then
 * hangs on that index is what goes wrong. And counts are a weak signal: a
 * season can have the same number of episodes in both orderings and still be
 * shuffled. A title at `S04E09` that Sonarr calls "Local Ad" and Plex calls
 * "Dinner Party" is the bug itself, observed directly.
 *
 * Titles are noisy across providers — "Chair Model" vs "The Chair Model",
 * "Goodbye, Toby" vs "Goodbye, Toby (1)" — so a season is only flagged when
 * several of its episodes disagree *and* they are a real share of it. One
 * provider's spelling of one title must never be enough to send someone into
 * Plex's advanced settings.
 *
 * Pure, so the thresholds can be tested against the case that prompted all of
 * this without a server.
 */

export interface LeafLike {
  season: number;
  episode: number;
  title: string;
  files: string[];
}

export interface SonarrEpisodeLike {
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  hasFile: boolean;
  episodeFileId?: number;
}

export interface OrderingEvidence {
  /** The seasons that disagree, and by how much. */
  seasons: Array<{ season: number; compared: number; mismatched: number }>;
  /** A few disagreeing episodes, so the reason is visible and not just the verdict. */
  examples: Array<{ code: string; plex: string; sonarr: string }>;
  /** Files Sonarr says cover more than one episode — the shape that suffers most from a wrong ordering. */
  multiEpisodeFiles: number;
}

export interface ShowComparison {
  ordering: OrderingEvidence | null;
  /** Episodes Sonarr has a file for that Plex doesn't list. Only reported when the ordering agrees. */
  missing: string[];
}

/** A season disagrees when at least this many of its episodes do… */
const MIN_MISMATCHES = 3;
/** …and they are at least this share of the episodes compared. */
const MIN_MISMATCH_SHARE = 0.25;
const MAX_EXAMPLES = 6;

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/**
 * A title reduced to what two providers can be expected to agree on.
 *
 * Drops a part marker ("(1)", "Part 2", "Pt. 2") because a split episode is
 * exactly where the orderings differ, and a TMDb "Goodbye, Toby" beside a TVDB
 * "Goodbye, Toby (1)" is the same episode named by two conventions, not
 * evidence. Drops a leading article for the same reason.
 */
export function normaliseTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\((?:part\s*)?\d+\)\s*$/, "")
    .replace(/[\s,:-]*(?:part|pt\.?)\s*\d+\s*$/, "")
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

export function titlesAgree(a: string, b: string): boolean {
  const na = normaliseTitle(a);
  const nb = normaliseTitle(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  // One provider's subtitle ("Pilot" vs "Pilot: Part One" survives the
  // part-strip as "pilotpartone"), but only for titles long enough that
  // containment means something — "a" is in everything.
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return short.length >= 4 && long.includes(short);
}

/** Sonarr's placeholder for an episode nobody has named yet. Comparing against it proves nothing. */
function isPlaceholder(title: string | undefined): boolean {
  if (!title) return true;
  return /^(?:tba|tbd|episode\s*\d+)$/i.test(title.trim());
}

export function compareShow(leaves: LeafLike[], episodes: SonarrEpisodeLike[]): ShowComparison {
  // Specials are left out on both sides: season 0 is numbered by whoever
  // added each special, and the two providers rarely agree even when every
  // regular season does.
  const sonarr = new Map<string, SonarrEpisodeLike>();
  for (const ep of episodes) {
    if (ep.seasonNumber > 0) sonarr.set(episodeCode(ep.seasonNumber, ep.episodeNumber), ep);
  }

  const perSeason = new Map<number, { compared: number; mismatched: number }>();
  const examples: OrderingEvidence["examples"] = [];
  const plexCodes = new Set<string>();

  for (const leaf of [...leaves].sort((a, b) => a.season - b.season || a.episode - b.episode)) {
    if (leaf.season <= 0) continue;
    const code = episodeCode(leaf.season, leaf.episode);
    plexCodes.add(code);
    const ep = sonarr.get(code);
    if (!ep || isPlaceholder(ep.title)) continue;

    const stats = perSeason.get(leaf.season) ?? { compared: 0, mismatched: 0 };
    stats.compared++;
    if (!titlesAgree(leaf.title, ep.title ?? "")) {
      stats.mismatched++;
      if (examples.length < MAX_EXAMPLES) examples.push({ code, plex: leaf.title, sonarr: ep.title ?? "" });
    }
    perSeason.set(leaf.season, stats);
  }

  const seasons = [...perSeason]
    .filter(([, s]) => s.mismatched >= MIN_MISMATCHES && s.mismatched / s.compared >= MIN_MISMATCH_SHARE)
    .map(([season, s]) => ({ season, ...s }));

  if (seasons.length > 0) {
    const flagged = new Set(seasons.map((s) => s.season));
    const filesPerId = new Map<number, number>();
    for (const ep of episodes) {
      if (ep.hasFile && ep.episodeFileId) filesPerId.set(ep.episodeFileId, (filesPerId.get(ep.episodeFileId) ?? 0) + 1);
    }
    return {
      ordering: {
        seasons,
        // Examples from the flagged seasons only: a stray disagreement in a
        // season that is otherwise fine would read as part of the case.
        examples: examples.filter((e) => flagged.has(Number(e.code.slice(1, 3)))),
        multiEpisodeFiles: [...filesPerId.values()].filter((n) => n > 1).length,
      },
      // Under a wrong ordering Plex's episode list is not a list of what it
      // has scanned, so "missing" would mostly be the same problem again.
      missing: [],
    };
  }

  const missing = episodes
    .filter((ep) => ep.hasFile && ep.seasonNumber > 0)
    .map((ep) => episodeCode(ep.seasonNumber, ep.episodeNumber))
    .filter((code) => !plexCodes.has(code))
    .sort();
  return { ordering: null, missing };
}

/**
 * The folder a show's files live in on the Plex server, for a targeted scan.
 *
 * The parent of a file, or its grandparent when the parent is a season folder,
 * so one scan covers every season. Taken from Plex's own paths rather than
 * Sonarr's: the two often see the same disk under different mounts.
 */
export function showFolder(leaves: LeafLike[]): string | null {
  const file = leaves.flatMap((l) => l.files)[0];
  if (!file) return null;
  const sep = file.includes("\\") && !file.includes("/") ? "\\" : "/";
  const parts = file.split(sep);
  parts.pop();
  if (/^(?:season\s*\d+|specials|s\d+)$/i.test(parts.at(-1) ?? "")) parts.pop();
  const folder = parts.join(sep);
  return folder || null;
}

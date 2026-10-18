/**
 * Where Plex sees a folder the *Arr names.
 *
 * Radarr and Plex usually run in separate containers, so one folder has two
 * names: Radarr's `/movies/Heat (1995)` is Plex's `/data/media/movies/Heat
 * (1995)`. Asking Plex to scan the *Arr's path scans nothing, silently. The
 * mapping is never configured anywhere Tinkerbell can read, so it is learnt
 * from an item both sides already agree on: a film from the same root folder
 * that Plex has matched. Its *Arr folder and its Plex folder share the part
 * below the root, and what is left over on the Plex side is the Plex root.
 */

function separatorOf(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function trimTrailing(path: string): string {
  return path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
}

/** `path` below `root`, as segments, or null when it isn't below it. */
function segmentsBelow(root: string, path: string): string[] | null {
  const r = trimTrailing(root);
  const p = trimTrailing(path);
  if (!p.startsWith(r)) return null;
  const rest = p.slice(r.length);
  if (rest !== "" && !/^[\\/]/.test(rest)) return null;
  return rest.split(/[\\/]+/).filter(Boolean);
}

/**
 * The Plex-side root for an *Arr root folder, from one item both sides know:
 * its *Arr folder and the folder Plex holds it in. Null when they don't end
 * the same way — a renamed folder, or a sibling Plex matched to something
 * else — since a guessed root scans the wrong place and reports success.
 */
export function learnPlexRoot(arrRoot: string, arrFolder: string, plexFolder: string): string | null {
  const below = segmentsBelow(arrRoot, arrFolder);
  if (!below || below.length === 0) return null;
  const sep = separatorOf(plexFolder);
  const plexSegments = trimTrailing(plexFolder).split(/[\\/]/);
  const tail = plexSegments.slice(-below.length);
  if (tail.length !== below.length || tail.some((s, i) => s !== below[i])) return null;
  const root = plexSegments.slice(0, -below.length).join(sep);
  return root || sep;
}

/** `arrPath` under `arrRoot`, renamed to sit under `plexRoot` instead. */
export function toPlexPath(arrRoot: string, arrPath: string, plexRoot: string): string | null {
  const below = segmentsBelow(arrRoot, arrPath);
  if (!below || below.length === 0) return null;
  const sep = separatorOf(plexRoot);
  const root = trimTrailing(plexRoot);
  return root === sep ? sep + below.join(sep) : [root, ...below].join(sep);
}

/** The folder a file is in. */
export function folderOf(file: string): string {
  const sep = separatorOf(file);
  const parts = file.split(sep);
  parts.pop();
  return parts.join(sep);
}

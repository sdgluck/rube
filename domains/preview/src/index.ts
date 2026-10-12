/**
 * Preview module — the Plex home view as a specific shared user sees it.
 *
 * Asked of Plex with the user's own share token where plex.tv gives us one,
 * which is every share. It used to be reconstructed from the owner's hubs,
 * filtered by the share's libraries and label filter — but `/hubs` never
 * returns `Label` on its items, so any user with a label filter (everyone,
 * once personalization is on) was shown an empty home. The reconstruction
 * remains only for a user with no token, and says it is approximate.
 */

import type { PlexClient, PlexHubItem, PlexHomeHub } from "@tinkerbell/plex";

export interface PreviewHubItem {
  ratingKey: string;
  title: string;
  type: string;
  year?: number;
  thumb?: string;
  art?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number;
  viewOffset?: number;
  addedAt?: number;
  contentRating?: string;
  librarySectionID?: number;
  librarySectionTitle?: string;
}

export interface PreviewHub {
  key: string;
  identifier: string;
  title: string;
  type: string;
  context?: string;
  items: PreviewHubItem[];
}

export interface PreviewResult {
  user: { userId: number; username: string } | null;
  /** Rebuilt from the owner's hubs rather than read as the user. */
  approximate: boolean;
  hubs: PreviewHub[];
  warnings: string[];
}

/**
 * The `label=` clauses of a plex.tv share filter, e.g.
 * `contentRating=PG|label=Tinkerbell,User:sam`. `|` separates clauses, which
 * must all match; `,` separates a clause's values, any of which may. A bare
 * token after a `|` is ignored, as Plex ignores it — this used to read `|` as
 * OR, so the preview showed the old `label=Tinkerbell|User:sam` restriction
 * admitting the user's own rows when Plex admitted only `Tinkerbell`.
 *
 * Returns a list of clauses; each clause is a list of accepted label tags
 * (OR within); an item matches if it satisfies ALL clauses (AND across).
 * Empty/missing filter → returns []  (no restriction).
 */
export function parseLabelFilter(expr: string): string[][] {
  if (!expr) return [];
  return expr
    .split("|")
    .map((clause) => clause.trim())
    .filter((clause) => clause.slice(0, clause.indexOf("=")).trim() === "label")
    .map((clause) =>
      clause
        .slice(clause.indexOf("=") + 1)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .filter((clause) => clause.length > 0);
}

export function itemPassesLabelFilter(item: PlexHubItem, clauses: string[][]): boolean {
  if (clauses.length === 0) return true;
  const itemLabels = new Set(item.labels.map((l) => l.toLowerCase()));
  for (const clause of clauses) {
    const ok = clause.some((label) => itemLabels.has(label.toLowerCase()));
    if (!ok) return false;
  }
  return true;
}

function itemTypeUsesFilter(type: string): "movies" | "tv" | null {
  if (type === "movie") return "movies";
  if (type === "show" || type === "season" || type === "episode") return "tv";
  return null;
}

function toPreviewItem(item: PlexHubItem): PreviewHubItem {
  return {
    ratingKey: item.ratingKey,
    title: item.title,
    type: item.type,
    year: item.year,
    thumb: item.thumb,
    art: item.art,
    parentThumb: item.parentThumb,
    grandparentThumb: item.grandparentThumb,
    grandparentTitle: item.grandparentTitle,
    parentTitle: item.parentTitle,
    parentIndex: item.parentIndex,
    index: item.index,
    duration: item.duration,
    viewOffset: item.viewOffset,
    addedAt: item.addedAt,
    contentRating: item.contentRating,
    librarySectionID: item.librarySectionID,
    librarySectionTitle: item.librarySectionTitle,
  };
}

function toPreviewHub(hub: PlexHomeHub, items: PlexHubItem[]): PreviewHub {
  return {
    key: hub.hubKey,
    identifier: hub.hubIdentifier,
    title: hub.title,
    type: hub.type,
    context: hub.context,
    items: items.map(toPreviewItem),
  };
}

function filterItemsBySection(items: PlexHubItem[], sectionId: number | null): PlexHubItem[] {
  if (sectionId == null) return items;
  return items.filter((i) => i.librarySectionID === sectionId);
}

export function isPersonalProgressHub(hub: PlexHomeHub): boolean {
  // Continue Watching / On Deck reflect the admin's per-user watch progress,
  // which can't be reproduced for a shared user without their token.
  const ctx = (hub.context || "").toLowerCase();
  const id = (hub.hubIdentifier || "").toLowerCase();
  const title = (hub.title || "").toLowerCase();
  return (
    ctx.includes("continuewatching") ||
    ctx.includes("ondeck") ||
    ctx.includes("continue.watching") ||
    ctx.includes("continue_watching") ||
    id.includes("continuewatching") ||
    id.includes("ondeck") ||
    id.includes("continue.watching") ||
    title.includes("continue watching") ||
    title === "on deck"
  );
}

function sectionHubs(hubs: PlexHomeHub[], sectionId: number | null): PreviewHub[] {
  const out: PreviewHub[] = [];
  for (const h of hubs) {
    const items = filterItemsBySection(h.items, sectionId);
    if (items.length > 0) out.push(toPreviewHub(h, items));
  }
  return out;
}

export async function getPreviewForUser(
  client: PlexClient,
  userId: number | null,
  sectionId: number | null = null,
  count: number = 12,
): Promise<PreviewResult> {
  const warnings: string[] = [];
  // Per-hub item count caps Plex's response size. 12 fills the visible row at
  // typical viewport widths and is fast; the page issues a follow-up call with
  // a larger count to fill in items further down each row.
  if (userId == null) {
    return {
      user: null,
      approximate: false,
      hubs: sectionHubs(await client.getHomeHubs({ count }), sectionId),
      warnings,
    };
  }

  const identity = await client.getIdentity();
  const [sharings, sharedDetails] = await Promise.all([
    client.getSharings(identity.machineIdentifier),
    client.getSharedServerDetails(identity.machineIdentifier),
  ]);

  const sharing = sharings.find((s) => s.userId === userId);
  if (!sharing) {
    warnings.push(`User ${userId} not found in sharings; showing unfiltered hubs.`);
    return {
      user: null,
      approximate: true,
      hubs: sectionHubs(await client.getHomeHubs({ count }), sectionId),
      warnings,
    };
  }
  const user = { userId: sharing.userId, username: sharing.username };

  const detail = sharedDetails.find((d) => d.userId === userId);
  if (detail?.accessToken) {
    // Plex applies the share's libraries and label filters itself, and the
    // Continue Watching / On Deck rows are genuinely theirs.
    const hubs = await client.getHomeHubs({ count, asToken: detail.accessToken });
    return { user, approximate: false, hubs: sectionHubs(hubs, sectionId), warnings };
  }

  const hubs = await client.getHomeHubs({ count });
  const allowedSections = detail ? new Set(detail.librarySectionIds) : null;
  const movieClauses = detail ? parseLabelFilter(detail.filterMovies) : [];
  const tvClauses = detail ? parseLabelFilter(detail.filterTelevision) : [];

  if (!detail) {
    warnings.push("No SharedServer record found — showing all libraries without label filtering.");
  }

  const filteredHubs: PreviewHub[] = [];
  let hidPersonalHub = false;
  for (const hub of hubs) {
    if (isPersonalProgressHub(hub)) {
      hidPersonalHub = true;
      continue;
    }
    const kept: PlexHubItem[] = [];
    for (const item of hub.items) {
      if (allowedSections && item.librarySectionID != null && !allowedSections.has(item.librarySectionID)) {
        continue;
      }
      if (sectionId != null && item.librarySectionID !== sectionId) continue;
      const which = itemTypeUsesFilter(item.type);
      const clauses = which === "movies" ? movieClauses : which === "tv" ? tvClauses : [];
      if (!itemPassesLabelFilter(item, clauses)) continue;
      kept.push(item);
    }
    if (kept.length > 0) filteredHubs.push(toPreviewHub(hub, kept));
  }

  if (hidPersonalHub) {
    warnings.push("Hiding Continue Watching / On Deck — those reflect the admin's watch progress, not this user's.");
  }

  return { user, approximate: true, hubs: filteredHubs, warnings };
}

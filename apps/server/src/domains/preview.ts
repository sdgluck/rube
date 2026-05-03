/**
 * Preview module — render an approximation of the Plex home view as a
 * specific shared user would see it, by filtering admin-fetched hubs by
 * the user's library access and label filters.
 */

import type { PlexClient, PlexHubItem, PlexHomeHub } from "../clients/plex.ts";

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
  hubs: PreviewHub[];
  warnings: string[];
}

/**
 * Parse a Plex label-filter expression like `label=Tinkerbell|User:Sam` or
 * `label=A,label=B`. Per plex-api.md: `|` = OR within a value, `,` = AND
 * between filter clauses.
 *
 * Returns a list of clauses; each clause is a list of accepted label tags
 * (OR within); an item matches if it satisfies ALL clauses (AND across).
 * Empty/missing filter → returns []  (no restriction).
 */
function parseLabelFilter(expr: string): string[][] {
  if (!expr) return [];
  return expr
    .split(",")
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) => {
      // Strip leading `label=` if present.
      const eq = clause.indexOf("=");
      const value = eq >= 0 ? clause.slice(eq + 1) : clause;
      return value
        .split("|")
        .map((v) => v.trim())
        .filter(Boolean);
    })
    .filter((clause) => clause.length > 0);
}

function itemPassesLabelFilter(item: PlexHubItem, clauses: string[][]): boolean {
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

function isPersonalProgressHub(hub: PlexHomeHub): boolean {
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

export async function getPreviewForUser(
  client: PlexClient,
  userId: number | null,
  sectionId: number | null = null,
): Promise<PreviewResult> {
  const warnings: string[] = [];
  const hubs = await client.getHomeHubs({ count: 25 });

  if (userId == null) {
    const out: PreviewHub[] = [];
    for (const h of hubs) {
      const items = filterItemsBySection(h.items, sectionId);
      if (items.length > 0) out.push(toPreviewHub(h, items));
    }
    return { user: null, hubs: out, warnings };
  }

  const identity = await client.getIdentity();
  const [sharings, sharedDetails] = await Promise.all([
    client.getSharings(identity.machineIdentifier),
    client.getSharedServerDetails(identity.machineIdentifier),
  ]);

  const sharing = sharings.find((s) => s.userId === userId);
  if (!sharing) {
    warnings.push(`User ${userId} not found in sharings; showing unfiltered hubs.`);
    const out: PreviewHub[] = [];
    for (const h of hubs) {
      const items = filterItemsBySection(h.items, sectionId);
      if (items.length > 0) out.push(toPreviewHub(h, items));
    }
    return { user: null, hubs: out, warnings };
  }

  const detail = sharedDetails.find((d) => d.userId === userId);
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

  return {
    user: { userId: sharing.userId, username: sharing.username },
    hubs: filteredHubs,
    warnings,
  };
}

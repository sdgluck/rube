/**
 * The judgements the list search makes about a result.
 *
 * Extracted from the components for the same reason `discover.ts` was:
 * `apps/web`'s test glob is `*.test.ts` and there is no DOM, so what can be
 * tested is what can be pulled out of the renderer. The counting is worth
 * pulling out — "how much of this do I already have" is the number that
 * decides whether a list is worth a rule, and it is exactly the kind of thing
 * that regresses silently inside a `.map()`.
 */

/** The providers with a list-search endpoint. TMDb and IMDb have none. */
export type ListProvider = "mdblist" | "trakt";

export const PROVIDER_LABELS: Record<ListProvider, string> = {
  mdblist: "MDBList",
  trakt: "Trakt",
};

export function providerSettingsPath(provider: ListProvider): string {
  return `/settings/databases/${provider}`;
}

export interface ListHit {
  provider: ListProvider;
  listId: string;
  name: string;
  owner: string;
  description: string;
  itemCount: number;
  likes: number;
}

export interface ListPreviewItem {
  title: string;
  year: number | null;
  mediaType: "movie" | "tv";
  plexRatingKey: string | null;
  inArr: unknown[];
}

/** `by garycrawfordgc · 300 items · 477 likes`, minus whatever is missing. */
export function describeList(hit: Pick<ListHit, "owner" | "itemCount" | "likes">): string {
  const parts: string[] = [];
  if (hit.owner) parts.push(`by ${hit.owner}`);
  if (hit.itemCount > 0) parts.push(`${hit.itemCount} ${hit.itemCount === 1 ? "item" : "items"}`);
  // Zero likes is a fact about a list, but a lonely "0 likes" beside a name
  // reads as a judgement on it, so it is left off rather than shown.
  if (hit.likes > 0) parts.push(`${hit.likes} ${hit.likes === 1 ? "like" : "likes"}`);
  return parts.join(" · ");
}

/**
 * The line that decides whether a list is worth a rule.
 *
 * "Held" means Plex has it *or* an *Arr does — the question being answered is
 * "would this rule actually build anything", and a title already wanted in
 * Radarr is one this list would not bring in either.
 */
export function describeHoldings(items: ListPreviewItem[], truncated: boolean): string {
  if (items.length === 0) return "This list is empty.";
  const held = items.filter((i) => i.plexRatingKey || i.inArr.length > 0).length;
  const scope = truncated ? `the first ${items.length}` : `all ${items.length}`;
  if (held === 0) return `You have none of ${scope}.`;
  if (held === items.length) return `You already have ${scope}.`;
  return `You have ${held} of ${scope}.`;
}

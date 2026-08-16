import { createContext, useContext } from "react";
import type { Collection, CollectionItem } from "./types.ts";

export interface CollectionContext {
  ratingKey: string;
  collection: Collection;
  items: CollectionItem[];
  itemsLoading: boolean;
  isSmart: boolean;
  /** Re-read the collection and its members after a change on the Plex side. */
  refresh: () => void;
  /** Opens the smart-filter drawer, which the layout owns because the hero links to it. */
  openFilters: () => void;
}

const Ctx = createContext<CollectionContext | null>(null);

export const CollectionProvider = Ctx.Provider;

/**
 * The collection the tab is a tab *of*.
 *
 * Through context rather than three copies of the same query: the layout has
 * already fetched the collection and its members to render the hero and the
 * tab counts, and a tab refetching them would show its own loading state
 * underneath a header that is plainly already loaded.
 */
export function useCollection(): CollectionContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCollection must be used inside the collection detail layout");
  return ctx;
}

/**
 * Open the search palette from anywhere.
 *
 * On a desktop it opens from the sidebar button or ⌘K; a phone has neither,
 * so the header's Search button and the More screen's search field raise it
 * through this event, which `App` listens for.
 */
export const OPEN_SEARCH_EVENT = "rube:open-search";

export function openSearch(): void {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

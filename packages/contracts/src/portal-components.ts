/**
 * The parts of the end-user portal an admin can switch off.
 *
 * The portal used to show every tab and every section to everyone, so a
 * server with cleanup turned off still offered a "Leaving soon" tab that could
 * only ever say nothing was leaving. Each entry here is one switch on
 * Settings → Portal → Components; a component is shown when its switch is on
 * *and* whatever it `requires` is configured, so switching a feature off takes
 * its portal surface with it without the admin having to remember to.
 *
 * Lives in contracts because the server enforces these and the admin page
 * renders them — one list, so a component cannot be switchable in one and
 * missing from the other.
 */

/** A feature a component is meaningless without. */
export type PortalPrerequisite = "cleanup" | "smtp";

export type PortalComponentGroup = "tabs" | "tastes" | "actions";

interface PortalComponentDef {
  id: string;
  group: PortalComponentGroup;
  label: string;
  /** The tab this lives on: switching the tab off hides it too. */
  parent?: string;
  requires?: PortalPrerequisite;
}

export const PORTAL_COMPONENTS = [
  { id: "tab.collections", group: "tabs", label: "Your collections" },
  { id: "tab.tastes", group: "tabs", label: "Your tastes" },
  { id: "tab.leaving", group: "tabs", label: "Leaving soon", requires: "cleanup" },
  { id: "tastes.genres", group: "tastes", label: "Genres", parent: "tab.tastes" },
  { id: "tastes.moods", group: "tastes", label: "Moods", parent: "tab.tastes" },
  { id: "tastes.neverRecommend", group: "tastes", label: "Never recommend", parent: "tab.tastes" },
  { id: "tastes.ratingFloor", group: "tastes", label: "Minimum rating", parent: "tab.tastes" },
  { id: "tastes.rowCount", group: "tastes", label: "Rows on my home", parent: "tab.tastes" },
  { id: "tastes.watchedBias", group: "tastes", label: "Watched bias", parent: "tab.tastes" },
  { id: "tastes.strictHate", group: "tastes", label: "Never show avoided genres", parent: "tab.tastes" },
  { id: "tastes.digest", group: "tastes", label: "Email digest", parent: "tab.tastes", requires: "smtp" },
  { id: "action.notForMe", group: "actions", label: "“Not for me” on collections", parent: "tab.collections" },
  { id: "action.keep", group: "actions", label: "“Keep this” on leaving soon", parent: "tab.leaving" },
] as const satisfies readonly PortalComponentDef[];

export type PortalComponentId = (typeof PORTAL_COMPONENTS)[number]["id"];

export const PORTAL_COMPONENT_IDS: readonly PortalComponentId[] = PORTAL_COMPONENTS.map((c) => c.id);

export function isPortalComponentId(id: string): id is PortalComponentId {
  return (PORTAL_COMPONENT_IDS as readonly string[]).includes(id);
}

/**
 * The `preferences` keys each tastes section writes. The server drops a
 * hidden section's keys from a save rather than trusting the form to omit
 * them, and because a save merges over what is stored, the user's earlier
 * answer survives the section being hidden and is there when it comes back.
 */
export const TASTES_PREFERENCE_KEYS: Partial<Record<PortalComponentId, readonly string[]>> = {
  "tastes.genres": ["genres"],
  "tastes.moods": ["moods"],
  "tastes.neverRecommend": ["excludedTitles"],
  "tastes.ratingFloor": ["ratingFloor"],
  "tastes.rowCount": ["rowCount"],
  "tastes.watchedBias": ["watchedBias"],
  "tastes.strictHate": ["strictHate"],
  "tastes.digest": ["digest"],
};

export interface PortalComponentState {
  /** Shown to portal users. */
  on: boolean;
  /** The admin's switch, regardless of prerequisites. */
  enabled: boolean;
  /** Set when the switch is on but a feature it needs isn't. */
  unmet?: PortalPrerequisite;
}

/**
 * Resolves every component: its own switch, its prerequisite, and its tab's.
 * Pure so the admin page and the server agree by construction.
 */
export function resolvePortalComponents(
  hidden: readonly string[],
  met: Record<PortalPrerequisite, boolean>,
): Record<PortalComponentId, PortalComponentState> {
  const out = {} as Record<PortalComponentId, PortalComponentState>;
  // Tabs come first in the list, so a parent is always resolved before its
  // children read it.
  for (const c of PORTAL_COMPONENTS as readonly PortalComponentDef[]) {
    const id = c.id as PortalComponentId;
    const enabled = !hidden.includes(id);
    const unmet = c.requires && !met[c.requires] ? c.requires : undefined;
    const parentOn = c.parent ? out[c.parent as PortalComponentId].on : true;
    out[id] = { enabled, on: enabled && !unmet && parentOn, ...(unmet ? { unmet } : {}) };
  }
  return out;
}

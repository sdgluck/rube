export interface FeatureCatalogEntry {
  id: string;
  name: string;
  description: string;
  /** Default cron shown in the wizard (kept in sync with the server template). */
  defaultSchedule: string;
  /** Friendly note about prerequisites; informational only. */
  requires?: string;
}

export const FEATURE_CATALOG: FeatureCatalogEntry[] = [
  {
    id: "because-you-watched",
    name: "Because You Watched",
    description:
      "Generate personalised collections for each Plex user based on their recent watch history. Sharing restrictions are applied automatically so users only see their own collections.",
    defaultSchedule: "0 2 * * *",
    requires: "An AI provider configured under Settings → AI.",
  },
  {
    id: "shuffle",
    name: "Shuffle Hubs",
    description:
      "Randomise the order of items in shuffled hub collections so the Plex homescreen feels fresh between visits.",
    defaultSchedule: "*/30 * * * *",
  },
  {
    id: "overlays",
    name: "Apply Overlays",
    description:
      "Composite badges (quality, audio, ratings…) onto poster artwork so the information shows up on the Plex grid.",
    defaultSchedule: "",
    requires: "Configure overlay styles on the Overlays page first.",
  },
];

export function getFeatureCatalogEntry(featureId: string): FeatureCatalogEntry | undefined {
  return FEATURE_CATALOG.find((f) => f.id === featureId);
}

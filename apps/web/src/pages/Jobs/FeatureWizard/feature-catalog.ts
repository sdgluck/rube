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
      "Generate personalised collections for each Plex user based on their recent watch history, shaped by their preferences. Each user only sees their own collections.",
    defaultSchedule: "0 2 * * *",
    requires: "Personalized Home Screens (Settings → Personalization) and an AI provider (Settings → AI).",
  },
  {
    id: "personalize",
    name: "Personalized Collections",
    description:
      "For each opted-in user, re-run the rules you've marked personalizable using their preferences, producing per-user collections pinned to their own home.",
    defaultSchedule: "0 3 * * *",
    requires: "Personalized Home Screens (Settings → Personalization) and rules marked personalizable.",
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

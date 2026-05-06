const descriptions: Record<string, string> = {
  "sync-media": "Pulls movies and shows from Plex into the local database so other jobs can act on them.",
  "sync-collections": "Mirrors existing Plex collections into the database and keeps their items in sync.",
  generate: "Builds and updates rule-based collections in Plex from the rules you've defined.",
  "because-you-watched":
    "Generates personalised “Because You Watched” collections for each Plex user using their recent watch history.",
  shuffle: "Randomises the order of items in shuffled hub collections so the homescreen stays fresh.",
  "purge-runs": "Deletes job run records older than 7 days and prunes old health-check entries.",
  label:
    "Labels managed items and configures Plex sharing so each user only sees the collections they're permitted to.",
  "label-undo":
    "Removes the Tinkerbell labels and the matching Plex sharing restrictions applied by Apply Collection Restrictions.",
  overlays: "Renders configured overlays onto poster artwork and uploads the composited posters to Plex.",
  "overlays-remove": "Restores original poster artwork by removing previously applied overlays.",
  "sync-recently-added": "Refreshes the cached “Recently Added” stats shown on the dashboard.",
  "sync-most-watched": "Refreshes the cached “Most Watched” stats shown on the dashboard.",
  "sync-users": "Pulls the list of Plex users and their library access into the local database.",
  healthcheck: "Pings every configured external service and records its current health status.",
  "posters-refresh": "Re-fetches cached poster images and detects when artwork has changed in Plex.",
  "migrate-collections":
    "Imports existing Plex collections into Tinkerbell rule-based collections, optionally deleting the originals.",
};

export function getJobDescription(jobId: string): string | undefined {
  return descriptions[jobId];
}

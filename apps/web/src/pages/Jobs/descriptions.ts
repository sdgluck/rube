const descriptions: Record<string, string> = {
  "sync-media": "Pulls movies and shows from Plex into the local database so other jobs can act on them.",
  "sync-collections": "Mirrors existing Plex collections into the database and keeps their items in sync.",
  generate: "Builds and updates rule-based collections in Plex from the rules you've defined.",
  "because-you-watched":
    "Generates personalised “Because You Watched” collections for each Plex user using their recent watch history.",
  shuffle: "Randomises the order of items in shuffled hub collections so the homescreen stays fresh.",
  "purge-runs":
    "Deletes job run records older than 7 days, and prunes health-check entries and bandwidth test results past their retention.",
  label:
    "Labels managed items and configures Plex sharing so each user only sees the collections they're permitted to.",
  "label-undo":
    "Removes the Tinkerbell label from items and strips per-user labels from collections. Does not change sharing restrictions.",
  "byw-remove":
    "Tears down Because You Watched: deletes its collections from Plex and clears every shared user's sharing restrictions. Item-level Tinkerbell labels are left intact.",
  overlays: "Renders configured overlays onto poster artwork and uploads the composited posters to Plex.",
  "overlays-remove": "Restores original poster artwork by removing previously applied overlays.",
  "sync-recently-added": "Refreshes the cached “Recently Added” stats shown on the dashboard.",
  "sync-users": "Pulls the list of Plex users and their library access into the local database.",
  healthcheck: "Pings every configured external service and records its current health status.",
  "bandwidth-test":
    "Measures this server's internet download and upload speed against Cloudflare, and records the result. Moves up to 200 MB per run, and only on a link fast enough to do so in seconds.",
  "posters-refresh": "Re-fetches cached poster images and detects when artwork has changed in Plex.",
  "migrate-collections":
    "Imports existing Plex collections into Tinkerbell rule-based collections, optionally deleting the originals.",
};

export function getJobDescription(jobId: string): string | undefined {
  return descriptions[jobId];
}

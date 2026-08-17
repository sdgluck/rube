/**
 * "An Overseerr request became available" — the one rule trigger with no
 * existing job already asking the question.
 *
 * `item-added` is close but not the same thing, and the difference is the
 * whole point of the trigger: a request going available is *somebody asked for
 * this and now it's here*, which is what a "Recently requested" shelf is made
 * of. A file arriving is just a file arriving, and on a server where anything
 * is imported outside Overseerr the two sets diverge immediately.
 *
 * State is a set of ids rather than a timestamp watermark. Overseerr's request
 * list carries no `updatedAt`, and a request can go available, be reverted and
 * go available again — a watermark would miss the second one.
 */

import { fetchSeerrRequests } from "@tinkerbell/seerr";
import { getConfig, setConfig, createLogger, errorMessage, type JobContext } from "@tinkerbell/core";
import { runTriggeredRules } from "./rule-triggers.ts";

const log = createLogger("seerr-poll");

/**
 * How many ids to remember. This is "have I told anyone about this yet", not a
 * history: an install with ten thousand fulfilled requests does not need the
 * first nine thousand, and the config row is read on every poll.
 */
const REMEMBER = 2000;

/** How many requests to ask Overseerr for. Newest first, so this is a window. */
const PAGE = 100;

export async function pollSeerrRequests(ctx: JobContext): Promise<string> {
  const url = getConfig("global_seerr_url");
  const apiKey = getConfig("global_seerr_api_key");
  if (!url || !apiKey) return "Overseerr is not configured.";

  let available;
  try {
    available = await fetchSeerrRequests({ url, apiKey, filter: "available", limit: PAGE });
  } catch (err) {
    // Returned rather than thrown, like the playback poller: an Overseerr that
    // is down is not a fault of this job, and failing the run every poll would
    // bury the one that matters.
    log.warn("could not reach Overseerr", { err: errorMessage(err) });
    return `Could not reach Overseerr: ${errorMessage(err)}`;
  }

  const seen = new Set(getConfig("seerr_seen_available") ?? []);
  const fresh = available.filter((r) => !seen.has(r.id));

  // First run on an install with history: adopt everything without firing.
  // Otherwise enabling the trigger would run every listening rule against a
  // hundred requests that were fulfilled months ago.
  const firstRun = seen.size === 0;

  if (available.length > 0) {
    // Newest ids first, so the cap drops the oldest.
    const merged = [...available.map((r) => r.id), ...seen].slice(0, REMEMBER);
    setConfig("seerr_seen_available", [...new Set(merged)]);
  }

  if (fresh.length === 0) return "No newly available requests.";
  if (firstRun) return `Adopted ${fresh.length} already-fulfilled request(s) without running anything.`;

  const triggered = await runTriggeredRules(ctx, "request-fulfilled", fresh.length);
  const summary = `${fresh.length} request(s) became available.`;
  return triggered ? `${summary} ${triggered}` : summary;
}

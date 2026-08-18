import { type Services } from "@tinkerbell/composition";
import { createRuleTriggers } from "./rule-triggers.ts";
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
import { createLogger, errorMessage, type JobContext } from "@tinkerbell/core";

const log = createLogger("seerr-poll");

/**
 * How many ids to remember. This is "have I told anyone about this yet", not a
 * history: an install with ten thousand fulfilled requests does not need the
 * first nine thousand, and the config row is read on every poll.
 */
const REMEMBER = 2000;

/** How many requests to ask Overseerr for. Newest first, so this is a window. */
const PAGE = 100;

export function createSeerrPoll(deps: Services) {
  const { config } = deps;
  const { getConfig, setConfig } = config;
  const { runTriggeredRules } = createRuleTriggers(deps);

  async function pollSeerrRequests(ctx: JobContext): Promise<string> {
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
    //
    // "Have we polled before", not "is the set empty". An install whose Overseerr
    // has no fulfilled requests yet stores nothing, so an empty set stayed true
    // right up to the first genuine fulfilment — which was then adopted as
    // history and fired nothing, losing the one event the trigger exists for.
    const firstRun = !(getConfig("seerr_polled") ?? false);
    setConfig("seerr_polled", true);

    /** Commit the ids as told-about. Deliberately *after* the rules have run. */
    const remember = () => {
      if (available.length === 0) return;
      // Newest ids first, so the cap drops the oldest.
      const merged = [...available.map((r) => r.id), ...seen].slice(0, REMEMBER);
      setConfig("seerr_seen_available", [...new Set(merged)]);
    };

    if (fresh.length === 0) {
      remember();
      return "No newly available requests.";
    }
    if (firstRun) {
      remember();
      return `Adopted ${fresh.length} already-fulfilled request(s) without running anything.`;
    }

    // Marked seen only once the rules have had them. Committing first meant a
    // rule that threw lost its trigger permanently — the ids were already
    // remembered, so the next poll saw nothing new. Re-firing on the next poll is
    // the better failure of the two.
    const triggered = await runTriggeredRules(ctx, "request-fulfilled", fresh.length);
    remember();
    const summary = `${fresh.length} request(s) became available.`;
    return triggered ? `${summary} ${triggered}` : summary;
  }

  return { pollSeerrRequests };
}

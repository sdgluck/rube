/**
 * Watch It Again: one collection per person per film library, of films they
 * loved and haven't seen in years.
 *
 * Every other row is about something new. The films someone has watched
 * three times are the ones they'd most happily watch a fourth, and nothing on
 * Plex's Home ever brings them back: Continue Watching forgets a finished
 * film, and Recommended only offers what they haven't seen.
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **Finished, and not lately.** Only films they watched through, and
 *    nothing played in the last `minYearsAgo` years — a film they rewatched
 *    last month doesn't need offering again.
 *  - **By film, not by copy.** A 4K and a 1080p copy are one film, and a play
 *    of either counts for both.
 *  - **Rewatched most first.** Three viewings is a favourite; one is a film
 *    they saw.
 *  - **`watch_state`, never pruned**, with imported Plex history folded in —
 *    the years this row reaches back over mostly predate Rube, so the
 *    history import is what makes it worth having.
 */
import { WATCH_AGAIN_DEFAULTS } from "@rube/contracts";
import { ServicesToken, type Services } from "@rube/composition";
import { DAY_MS, displayTitle } from "@rube/core";
import type { JobContext, WatchAgainJobConfig } from "@rube/core";
import { createPlexClient, type PlexSection } from "@rube/plex";
import { ClockToken } from "@rube/ports";
import { plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { historyUserIds } from "../we-think-youd-like/profile.ts";
import {
  createPersonalRowWriter,
  noUsersError,
  ownRow,
  targetUsers,
  type PersonalRow,
} from "../../personalize/personal-row-writer.ts";
import { finishedFilms, pastFavourites, watchAgainSummary } from "./pick.ts";

export const WATCH_AGAIN_LABEL = "WatchItAgain";
export const WATCH_AGAIN_ROW_NAME = "Watch It Again";

interface SectionState {
  section: PlexSection;
  rows: PersonalRow[];
}

export function createWatchItAgainCommand(
  deps: Pick<Services, "clients" | "collections" | "config" | "db" | "preferences">,
  opts: { now?: () => number } = {},
) {
  const { clients, collections, config, db, preferences } = deps;
  const now = opts.now ?? Date.now;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;

  async function run(ctx: JobContext, cfg: WatchAgainJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const minYearsAgo = cfg.minYearsAgo ?? WATCH_AGAIN_DEFAULTS.minYearsAgo;
    const minItems = cfg.minItems ?? WATCH_AGAIN_DEFAULTS.minItems;
    const maxItems = cfg.maxItems ?? WATCH_AGAIN_DEFAULTS.maxItems;
    const pin = cfg.pinToHomepage ?? WATCH_AGAIN_DEFAULTS.pinToHomepage;
    const allowlist = cfg.users ?? [];

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    const users = targetUsers(db, allowlist);
    if (users.length === 0) throw noUsersError(allowlist);

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`rube watch-it-again`);
    ctx.log(`Server: ${url}`);
    const machineId = (await client.getIdentity()).machineIdentifier;
    const writer = createPersonalRowWriter({
      client,
      ctx,
      machineId,
      label: WATCH_AGAIN_LABEL,
      rowName: WATCH_AGAIN_ROW_NAME,
      collections,
    });

    // Film libraries only: rewatching a series is a different decision.
    const sections = new Map<string, SectionState>();
    for (const section of await resolveTargetSections(client, getConfig, cfg.sections)) {
      if (section.type !== "movie") continue;
      sections.set(section.key, { section, rows: await writer.listRows(section.key) });
    }
    if (sections.size === 0) {
      ctx.log("No film library to build in.");
      return;
    }

    // A year is 365 days here; a day either way doesn't matter to "a while back".
    const before = now() - minYearsAgo * 365 * DAY_MS;
    ctx.log(`Films finished and not played since ${new Date(before).toISOString().slice(0, 10)}.`);
    for (const [i, user] of users.entries()) {
      ctx.progress(i, users.length, user.name);
      const prefs = getOptedInPreferencesByUsername(user.username);
      const declined = (prefs?.excludedCollections ?? []).some(
        (t) => displayTitle(t).toLowerCase() === WATCH_AGAIN_ROW_NAME.toLowerCase(),
      );
      if (declined) {
        for (const state of sections.values()) {
          const existing = ownRow(state.rows, WATCH_AGAIN_LABEL, user.username);
          if (existing) await writer.deleteRow(existing.ratingKey, `${user.name} said it wasn't for them`);
        }
        continue;
      }
      const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
      const favourites = pastFavourites(finishedFilms(db, historyUserIds(user), [...sections.keys()]), before).filter(
        (f) => !excluded.has(f.title.toLowerCase()),
      );

      for (const state of sections.values()) {
        const mine = favourites
          .flatMap((f) =>
            f.copies.filter((c) => c.sectionId === state.section.key).map((c) => ({ ...c, title: f.title })),
          )
          .slice(0, maxItems);
        const existing = ownRow(state.rows, WATCH_AGAIN_LABEL, user.username);
        if (mine.length < minItems) {
          if (mine.length > 0 || existing) {
            ctx.log(`${user.name} — "${state.section.title}": ${mine.length} film(s), fewer than ${minItems}; no row.`);
          }
          if (existing) await writer.deleteRow(existing.ratingKey, "too few films in it");
          continue;
        }
        ctx.log(`${user.name} — "${state.section.title}": ${mine.map((m) => m.title).join(", ")}.`);
        await writer.writeRow(
          state.section,
          state.rows,
          user,
          mine.map((m) => m.ratingKey),
          watchAgainSummary(mine.map((m) => m.title)),
          pin,
        );
      }
    }

    // Rows for people no longer on the Users page; not with an allowlist set.
    if (allowlist.length === 0)
      await writer.sweepOrphans(
        [...sections.values()].map((s) => s.rows),
        users,
      );
    ctx.progress(users.length, users.length, "Done");
    ctx.log("All done!");
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: WatchAgainJobConfig): Promise<void> {
  return createWatchItAgainCommand(ctx.scope.resolve(ServicesToken), { now: ctx.scope.resolve(ClockToken) }).run(
    ctx,
    config,
  );
}

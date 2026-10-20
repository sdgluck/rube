/**
 * Your Requests Are Here: one collection per person per library, of what they
 * asked for in Overseerr that has arrived and they haven't got to yet.
 *
 * Overseerr can email when a request lands, but the email is gone by the time
 * someone sits down to watch, and "did my thing come in?" is answered by
 * scrolling the library. A row on their own Home answers it where they look.
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **Read from Overseerr each run.** Tinkerbell keeps no mirror of requests
 *    (`seerr-poll` remembers only which ids it has announced), and a mirror
 *    would be one more thing to fall out of step; a run is a few paged reads.
 *  - **Matched to the person by plex.tv id first.** Overseerr's own username
 *    is often empty for Plex-linked accounts, so names and email are the
 *    fallbacks, not the rule. Someone with no match gets no row, and the log
 *    says who.
 *  - **Gone once they've got to it**: a film watched through, a show played
 *    since it arrived. And gone after `maxAgeDays` either way — a request from
 *    last spring nobody watched is not news.
 *  - **The row is the per-person writer's**: their own title, edited in place,
 *    removed when empty, "Not for me" honoured.
 */
import { REQUESTS_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { DAY_MS, displayTitle } from "@tinkerbell/core";
import type { JobContext, RequestsJobConfig } from "@tinkerbell/core";
import { mediaItems, plexUsers } from "@tinkerbell/db";
import { createPlexClient, type PlexSection } from "@tinkerbell/plex";
import { ClockToken } from "@tinkerbell/ports";
import { iterSeerrRequests } from "@tinkerbell/seerr";
import { inArray } from "drizzle-orm";
import { plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { historyUserIds } from "../we-think-youd-like/profile.ts";
import {
  createPersonalRowWriter,
  noUsersError,
  ownRow,
  targetUsers,
  type PersonalRow,
} from "../../personalize/personal-row-writer.ts";
import { arrivedAt, createRequesterMatcher, gotTo, isArrived, requestsSummary } from "./match.ts";

export const REQUESTS_LABEL = "RequestsArrived";
export const REQUESTS_ROW_NAME = "Your Requests Are Here";
/**
 * How many available requests to read, newest first. A request asked for long
 * ago can arrive yesterday, so the window is on arrival and can't stop the
 * paging early; this bounds it instead.
 */
const MAX_SCAN = 500;

interface SectionState {
  section: PlexSection;
  rows: PersonalRow[];
}

export function createRequestsArrivedCommand(
  deps: Pick<Services, "clients" | "collections" | "config" | "db" | "preferences">,
  opts: { now?: () => number } = {},
) {
  const { clients, collections, config, db, preferences } = deps;
  const now = opts.now ?? Date.now;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;

  async function run(ctx: JobContext, cfg: RequestsJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const maxAgeDays = cfg.maxAgeDays ?? REQUESTS_DEFAULTS.maxAgeDays;
    const maxItems = cfg.maxItems ?? REQUESTS_DEFAULTS.maxItems;
    const pin = cfg.pinToHomepage ?? REQUESTS_DEFAULTS.pinToHomepage;
    const allowlist = cfg.users ?? [];

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    const seerrUrl = getConfig("global_seerr_url");
    const seerrApiKey = getConfig("global_seerr_api_key");
    if (!seerrUrl || !seerrApiKey)
      throw new Error("Overseerr URL and API key are required. Configure them in Settings.");
    const users = targetUsers(db, allowlist);
    if (users.length === 0) throw noUsersError(allowlist);

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell requests-arrived`);
    ctx.log(`Server: ${url}`);
    const machineId = (await client.getIdentity()).machineIdentifier;
    const writer = createPersonalRowWriter({
      client,
      ctx,
      machineId,
      label: REQUESTS_LABEL,
      rowName: REQUESTS_ROW_NAME,
      collections,
    });

    const sections = new Map<string, SectionState>();
    for (const section of await resolveTargetSections(client, getConfig, cfg.sections)) {
      if (section.type !== "movie" && section.type !== "show") continue;
      sections.set(section.key, { section, rows: await writer.listRows(section.key) });
    }
    if (sections.size === 0) {
      ctx.log("No film or TV library to build in.");
      return;
    }

    // Who asked for what, among everyone this job builds for.
    const matchRequester = createRequesterMatcher(
      db
        .select({ userId: plexUsers.userId, username: plexUsers.username, email: plexUsers.email })
        .from(plexUsers)
        .all(),
    );
    const wanted = new Set(users.map((u) => u.username));
    const cutoff = now() - maxAgeDays * DAY_MS;
    const byUser = new Map<string, Map<string, number>>();
    const strangers = new Set<string>();
    let scanned = 0;
    for await (const req of iterSeerrRequests({ url: seerrUrl, apiKey: seerrApiKey, filter: "available" })) {
      ctx.signal.throwIfAborted();
      if (++scanned > MAX_SCAN) break;
      if (!isArrived(req)) continue;
      const when = arrivedAt(req);
      if (when < cutoff) continue;
      const who = matchRequester(req.requestedBy);
      if (!who) {
        const by = req.requestedBy;
        strangers.add(by.plexUsername || by.username || by.displayName || by.email || "someone");
        continue;
      }
      if (!wanted.has(who.username)) continue;
      const theirs = byUser.get(who.username) ?? new Map<string, number>();
      // The same title asked for twice (a 4K request, a second season) is one entry, at its latest arrival.
      theirs.set(req.media.ratingKey, Math.max(theirs.get(req.media.ratingKey) ?? 0, when));
      byUser.set(who.username, theirs);
    }
    ctx.log(`Read ${Math.min(scanned, MAX_SCAN)} available request(s) from Overseerr.`);
    if (strangers.size > 0) {
      ctx.log(`Requests from ${[...strangers].join(", ")} match nobody on the Users page; they get no row.`);
    }

    // Where each arrival is, from the library index.
    const keys = [...new Set([...byUser.values()].flatMap((m) => [...m.keys()]))];
    const where = new Map<string, { sectionId: string; title: string; type: string }>();
    for (let i = 0; i < keys.length; i += 500) {
      for (const row of db
        .select({
          ratingKey: mediaItems.ratingKey,
          sectionId: mediaItems.sectionId,
          title: mediaItems.title,
          type: mediaItems.type,
        })
        .from(mediaItems)
        .where(inArray(mediaItems.ratingKey, keys.slice(i, i + 500)))
        .all()) {
        where.set(row.ratingKey, row);
      }
    }
    const unindexed = keys.filter((k) => !where.has(k)).length;
    if (unindexed > 0) ctx.log(`${unindexed} arrival(s) aren't in the library index yet; Sync Media picks them up.`);

    for (const [i, user] of users.entries()) {
      ctx.progress(i, users.length, user.name);
      const prefs = getOptedInPreferencesByUsername(user.username);
      const declined = (prefs?.excludedCollections ?? []).some(
        (t) => displayTitle(t).toLowerCase() === REQUESTS_ROW_NAME.toLowerCase(),
      );
      if (declined) {
        for (const state of sections.values()) {
          const existing = ownRow(state.rows, REQUESTS_LABEL, user.username);
          if (existing) await writer.deleteRow(existing.ratingKey, `${user.name} said it wasn't for them`);
        }
        continue;
      }
      const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
      const arrivals = [...(byUser.get(user.username) ?? [])]
        .flatMap(([ratingKey, at]) => {
          const item = where.get(ratingKey);
          return item && sections.has(item.sectionId) ? [{ ratingKey, arrivedAt: at, ...item }] : [];
        })
        .filter((a) => !excluded.has(a.title.toLowerCase()));
      const seen = gotTo(db, historyUserIds(user), arrivals);
      const waiting = arrivals.filter((a) => !seen.has(a.ratingKey)).sort((a, b) => b.arrivedAt - a.arrivedAt);
      if (arrivals.length > 0) {
        ctx.log(`${user.name}: ${arrivals.length} arrived, ${seen.size} already watched, ${waiting.length} waiting.`);
      }

      for (const state of sections.values()) {
        const mine = waiting.filter((a) => a.sectionId === state.section.key).slice(0, maxItems);
        const existing = ownRow(state.rows, REQUESTS_LABEL, user.username);
        if (mine.length === 0) {
          if (existing) await writer.deleteRow(existing.ratingKey, "nothing left in it");
          continue;
        }
        await writer.writeRow(
          state.section,
          state.rows,
          user,
          mine.map((a) => a.ratingKey),
          requestsSummary(mine.map((a) => a.title)),
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
export default function run(ctx: JobContext, config: RequestsJobConfig): Promise<void> {
  return createRequestsArrivedCommand(ctx.scope.resolve(ServicesToken), { now: ctx.scope.resolve(ClockToken) }).run(
    ctx,
    config,
  );
}

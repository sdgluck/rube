/**
 * New For You: one collection per person per library, of what was added
 * lately that suits them.
 *
 * Plex's Recently Added is the same list for everyone, in the order files
 * landed — on a busy server a week of arrivals pushes the one film someone
 * would have loved off the end. This is that list, ordered by the person.
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **The window decides what's in it; taste decides the order.** Anything
 *    added within `windowDays` that they haven't seen is a candidate, so a
 *    person with no history still gets a row, newest first — and one with
 *    history gets theirs first.
 *  - **The shared taste order** (`taste-order.ts`): the built-in recommender
 *    when it's on, else their genre shares. No model is asked.
 *  - **Never something they've seen**, by film or by show, ever — a re-added
 *    file isn't news to someone who watched it last year.
 */
import { NEW_FOR_YOU_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { DAY_MS, displayTitle } from "@tinkerbell/core";
import type { JobContext, NewForYouJobConfig } from "@tinkerbell/core";
import { mediaItems } from "@tinkerbell/db";
import { createPlexClient, type PlexSection } from "@tinkerbell/plex";
import { ClockToken } from "@tinkerbell/ports";
import { and, desc, gte, inArray } from "drizzle-orm";
import { plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { everWatchedKeys, historyUserIds } from "../we-think-youd-like/profile.ts";
import {
  createPersonalRowWriter,
  noUsersError,
  ownRow,
  targetUsers,
  type PersonalRow,
} from "../../personalize/personal-row-writer.ts";
import { createTasteOrder } from "../../personalize/taste-order.ts";

export const NEW_FOR_YOU_LABEL = "NewForYou";
export const NEW_FOR_YOU_ROW_NAME = "New For You";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Added since 20 September, in the order we think you'll like them." */
export function newForYouSummary(since: number): string {
  const d = new Date(since);
  return `Added since ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, in the order we think you'll like them.`;
}

interface SectionState {
  section: PlexSection;
  rows: PersonalRow[];
  /** What arrived in the window, newest first. */
  arrivals: Array<{ ratingKey: string; title: string }>;
  genresByKey: Map<string, string[]>;
}

export function createNewForYouCommand(
  deps: Pick<Services, "clients" | "collections" | "config" | "db" | "preferences" | "recommendations">,
  opts: { now?: () => number } = {},
) {
  const { clients, collections, config, db, preferences, recommendations } = deps;
  const now = opts.now ?? Date.now;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;

  async function run(ctx: JobContext, cfg: NewForYouJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const windowDays = cfg.windowDays ?? NEW_FOR_YOU_DEFAULTS.windowDays;
    const minItems = cfg.minItems ?? NEW_FOR_YOU_DEFAULTS.minItems;
    const maxItems = cfg.maxItems ?? NEW_FOR_YOU_DEFAULTS.maxItems;
    const pin = cfg.pinToHomepage ?? NEW_FOR_YOU_DEFAULTS.pinToHomepage;
    const allowlist = cfg.users ?? [];

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    const users = targetUsers(db, allowlist);
    if (users.length === 0) throw noUsersError(allowlist);

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell new-for-you`);
    ctx.log(`Server: ${url}`);
    const machineId = (await client.getIdentity()).machineIdentifier;
    const writer = createPersonalRowWriter({
      client,
      ctx,
      machineId,
      label: NEW_FOR_YOU_LABEL,
      rowName: NEW_FOR_YOU_ROW_NAME,
      collections,
    });

    const since = now() - windowDays * DAY_MS;
    const sections: SectionState[] = [];
    for (const section of await resolveTargetSections(client, getConfig, cfg.sections)) {
      if (section.type !== "movie" && section.type !== "show") continue;
      // `addedAt` is Plex's, in seconds.
      const index = db
        .select({ ratingKey: mediaItems.ratingKey, title: mediaItems.title, genres: mediaItems.genres })
        .from(mediaItems)
        .where(
          and(
            inArray(mediaItems.sectionId, [section.key]),
            inArray(mediaItems.type, ["movie", "show"]),
            gte(mediaItems.addedAt, Math.floor(since / 1000)),
          ),
        )
        .orderBy(desc(mediaItems.addedAt))
        .all();
      sections.push({
        section,
        rows: await writer.listRows(section.key),
        arrivals: index.map((i) => ({ ratingKey: i.ratingKey, title: i.title })),
        genresByKey: new Map(index.filter((i) => i.genres?.length).map((i) => [i.ratingKey, i.genres!])),
      });
      ctx.log(`"${section.title}": ${index.length} title(s) added in the last ${windowDays} days.`);
    }
    if (sections.length === 0) {
      ctx.log("No film or TV library to build in.");
      return;
    }

    const taste = createTasteOrder({ db, recommendations, now });
    for (const [i, user] of users.entries()) {
      ctx.progress(i, users.length, user.name);
      const prefs = getOptedInPreferencesByUsername(user.username);
      const declined = (prefs?.excludedCollections ?? []).some(
        (t) => displayTitle(t).toLowerCase() === NEW_FOR_YOU_ROW_NAME.toLowerCase(),
      );
      if (declined) {
        for (const state of sections) {
          const existing = ownRow(state.rows, NEW_FOR_YOU_LABEL, user.username);
          if (existing) await writer.deleteRow(existing.ratingKey, `${user.name} said it wasn't for them`);
        }
        continue;
      }
      const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
      const seen = everWatchedKeys(db, historyUserIds(user));

      for (const state of sections) {
        const pool = state.arrivals
          .filter((a) => !seen.has(a.ratingKey) && !excluded.has(a.title.toLowerCase()))
          .map((a) => a.ratingKey);
        const existing = ownRow(state.rows, NEW_FOR_YOU_LABEL, user.username);
        if (pool.length < minItems) {
          if (existing) await writer.deleteRow(existing.ratingKey, `fewer than ${minItems} new titles for them`);
          continue;
        }
        const ordered = taste.order(user, pool, state.genresByKey).slice(0, maxItems);
        ctx.log(
          `${user.name} — "${state.section.title}": ${pool.length} new to them${taste.hasHistory(user) ? ", in their order" : ", newest first (no history yet)"}.`,
        );
        await writer.writeRow(state.section, state.rows, user, ordered, newForYouSummary(since), pin);
      }
    }

    // Rows for people no longer on the Users page; not with an allowlist set.
    if (allowlist.length === 0)
      await writer.sweepOrphans(
        sections.map((s) => s.rows),
        users,
      );
    ctx.progress(users.length, users.length, "Done");
    ctx.log("All done!");
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: NewForYouJobConfig): Promise<void> {
  return createNewForYouCommand(ctx.scope.resolve(ServicesToken), { now: ctx.scope.resolve(ClockToken) }).run(
    ctx,
    config,
  );
}

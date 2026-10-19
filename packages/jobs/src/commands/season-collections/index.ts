/**
 * Season Collections: a row per holiday per library, there while the holiday
 * is and gone after.
 *
 * The `seasonal` rule type already sorted films into holidays, but it built
 * every holiday all year round, so a Halloween row sat on Home in March unless
 * someone remembered to give the rule a date window. This is the version that
 * needs no remembering: each season carries its own window, and a daily run
 * creates the rows that are in season and deletes the ones that aren't.
 *
 * Two modes, like Because You Watched:
 *
 *  - `server` (the default): one row per season that everybody sees. Needs no
 *    personalization, because a Christmas row is the same for everyone.
 *  - `per-user`: "Christmas picks for you", the same pool ordered by each
 *    person's taste, built like the other personal rows (`personal-row.ts`).
 *
 * Choices, each for a failure the obvious version has:
 *
 *  - **Keywords, never the release month.** See `seasons.ts`: the month made
 *    every December release a Christmas film.
 *  - **The AI only tops up.** Keywords are free and explainable; the model is
 *    asked only when they find fewer than `minItems`, and a library with no AI
 *    configured still gets every row the keywords can fill.
 *  - **A short row keeps what it had.** When keywords alone fall short, the
 *    titles already in the row stay candidates. That keeps a model's earlier
 *    picks without asking again every morning — one call per season when it
 *    opens, not one per day it is open.
 *  - **Rows are found by `Season:<key>`, not by title**, so renaming a season
 *    edits its row. Titles carry an invisible per-season mark
 *    (`seasonRowTitle`) so this "Christmas" never pools its films with a
 *    `seasonal` rule's "Christmas" in the same library.
 *  - **Edited in place, swept in one pass.** A row that is wanted again
 *    tomorrow keeps its Plex key and wherever someone moved it; everything
 *    labelled for this job that wasn't written this run — out of season,
 *    switched off, below the minimum, a person who left — is deleted.
 */
import {
  activeSeasons,
  describeMonthDayWindow,
  resolveSeasons,
  SEASON_DEFAULTS,
  type ResolvedSeason,
} from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { DAY_MS, displayTitle, errorMessage, personalRowTitle, seasonRowTitle } from "@tinkerbell/core";
import type { JobContext, SeasonCollectionsJobConfig } from "@tinkerbell/core";
import { mediaItems, plexUsers } from "@tinkerbell/db";
import { LlmBudgetExceededError } from "@tinkerbell/domain.ai-usage";
import { createLlmClient, estimateTokens, type LlmConfig } from "@tinkerbell/llm";
import { createPlexClient, type PinOptions, type PlexSection } from "@tinkerbell/plex";
import { ClockToken } from "@tinkerbell/ports";
import { asc, eq } from "drizzle-orm";
import { itemLabel, libraryTitleMatcher, plexConnection, resolveTargetSections } from "../ai-collection-shared.ts";
import { createTmdbMetadataCommand } from "../generate/tmdb-metadata.ts";
import { indexItemsByTmdb } from "../generate/plex-index.ts";
import { personalRowLabels, personalRowPin } from "../../personalize/personal-row.ts";
import { BASELINE_LABEL } from "../../personalize/reconcile.ts";
import { buildTasteProfile, historyUserIds, titleWeight, watchedTitles } from "../we-think-youd-like/profile.ts";
import {
  matchSeason,
  parseSeasonAnswer,
  personalSeasonName,
  rankByGenreShare,
  rankCandidates,
  rowId,
  rowIdentity,
  SEASON_ANSWER_JSON_SCHEMA,
  SEASON_KEY_PREFIX,
  SEASON_LABEL,
  seasonPrompt,
  type RankInfo,
} from "./match.ts";

export { SEASON_LABEL } from "./match.ts";

const ANSWER_MAX_TOKENS = 2048;
/** How far back a person's taste is read, for ordering their row. */
const HISTORY_DAYS = 365;
/** A shared row is on every Home, like Because You Watched's server mode. */
const SHARED_PIN: PinOptions = { promotedToOwnHome: 1, promotedToRecommended: 1, promotedToSharedHome: 1 };

interface TargetUser {
  userId: number;
  username: string;
  name: string;
  isOwner: boolean;
}

type Row = { ratingKey: string; title: string; labels: string[] };

interface Library {
  items: Array<{ ratingKey: string; title: string; year?: number }>;
  keys: Set<string>;
  info: Map<string, RankInfo>;
  genresByKey: Map<string, string[]>;
  titleOf: Map<string, string>;
}

export function createSeasonCollectionsCommand(
  deps: Pick<
    Services,
    "aiUsage" | "clients" | "collections" | "config" | "db" | "health" | "preferences" | "recommendations"
  >,
  opts: { now?: () => number } = {},
) {
  const { aiUsage, clients, collections, config, db, health, preferences, recommendations } = deps;
  const now = opts.now ?? Date.now;
  const { track, budgetExceededReason } = aiUsage;
  const { plexHealthCallback } = clients;
  const { configuredTimezone, getConfig, getLlmConfig, getPersonalizedSharingStatus } = config;
  const { getOptedInPreferencesByUsername } = preferences;
  const { reportHealth } = health;
  const { upsertCollectionByKey, forgetCollections } = collections;
  const { hydrateTmdbDetails } = createTmdbMetadataCommand(deps);

  function targetUsers(allowlist: string[]): TargetUser[] {
    const all = db
      .select({
        userId: plexUsers.userId,
        username: plexUsers.username,
        name: plexUsers.name,
        isOwner: plexUsers.isOwner,
      })
      .from(plexUsers)
      .orderBy(asc(plexUsers.username))
      .all()
      .map((u) => ({ userId: u.userId, username: u.username, name: u.name || u.username, isOwner: u.isOwner === 1 }));
    if (allowlist.length === 0) return all;
    const wanted = new Set(allowlist.map((u) => u.toLowerCase()));
    return all.filter((u) => wanted.has(u.username.toLowerCase()) || wanted.has(u.name.toLowerCase()));
  }

  /** Ratings and genres from the library index — what a row is ordered by. */
  function indexMetadata(sectionId: string): { rating: Map<string, number | null>; genres: Map<string, string[]> } {
    const rating = new Map<string, number | null>();
    const genres = new Map<string, string[]>();
    for (const row of db
      .select({ ratingKey: mediaItems.ratingKey, rating: mediaItems.rating, genres: mediaItems.genres })
      .from(mediaItems)
      .where(eq(mediaItems.sectionId, sectionId))
      .all()) {
      rating.set(row.ratingKey, row.rating);
      if (row.genres?.length) genres.set(row.ratingKey, row.genres);
    }
    return { rating, genres };
  }

  async function askModel(llm: LlmConfig, ctx: JobContext, library: string, prompt: string): Promise<string> {
    const client = track(createLlmClient(llm), { feature: "season-collections" });
    try {
      const res = await client.complete({
        cacheablePrefix: library,
        prompt,
        maxTokens: ANSWER_MAX_TOKENS,
        jsonSchema: SEASON_ANSWER_JSON_SCHEMA,
        signal: ctx.signal,
      });
      reportHealth("LLM", "ok", `${res.provider}:${res.model} — ${res.tokensIn} in, ${res.tokensOut} out`);
      return res.text;
    } catch (err) {
      if (!(err instanceof LlmBudgetExceededError)) reportHealth("LLM", "error", errorMessage(err));
      throw err;
    }
  }

  async function run(ctx: JobContext, cfg: SeasonCollectionsJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const mode = cfg.mode ?? SEASON_DEFAULTS.mode;
    const pin = cfg.pinToHomepage ?? SEASON_DEFAULTS.pinToHomepage;
    const minItems = cfg.minItems ?? SEASON_DEFAULTS.minItems;
    const maxItems = Math.max(cfg.maxItems ?? SEASON_DEFAULTS.maxItems, minItems);
    const useAi = cfg.useAi ?? SEASON_DEFAULTS.useAi;
    const allowlist = cfg.users ?? [];

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    if (mode === "per-user" && getPersonalizedSharingStatus() !== "enabled") {
      // Without the sharing restrictions every person's row is on everyone's
      // Home — a dozen "Christmas picks for you" for each of them.
      throw new Error(
        "A row per person needs Personalized Home Screens turned on (Settings → Portal → Personalization). Switch to one row for everyone, or turn it on.",
      );
    }

    const today = new Date(now());
    const seasons = resolveSeasons(cfg);
    const active = activeSeasons(seasons, today, configuredTimezone());
    ctx.log(`tinkerbell season-collections (${mode === "server" ? "one row for everyone" : "a row per person"})`);
    ctx.log(`Server: ${url}`);
    ctx.log(
      active.length > 0
        ? `In season: ${active.map((s) => `${s.name} (${describeMonthDayWindow(s.activeFrom, s.activeTo)})`).join(", ")}.`
        : "Nothing is in season today; removing any rows left from the last one.",
    );

    let apiKey: string | undefined;
    if (active.length > 0) {
      apiKey = getConfig("global_tmdb_api_key") || undefined;
      if (!apiKey) throw new Error("TMDb API key is required to find each holiday's titles. Configure it in Settings.");
    }

    const users = mode === "per-user" ? targetUsers(allowlist) : [];
    if (mode === "per-user" && users.length === 0) {
      throw new Error(
        allowlist.length > 0
          ? `No matching users found for allowlist: ${allowlist.join(", ")}`
          : "No users synced yet — run Sync users, or refresh the Users page.",
      );
    }

    // The model is a top-up, so anything wrong with it narrows the run to
    // keywords rather than stopping it.
    const llmConfig = useAi ? getLlmConfig() : undefined;
    const budgetSpent = llmConfig ? budgetExceededReason() : null;
    let llm: LlmConfig | null = budgetSpent ? null : (llmConfig ?? null);
    if (active.length > 0) {
      if (!useAi) ctx.log("AI top-up is off; rows use keywords alone.");
      else if (!llmConfig) ctx.log("No AI provider configured; rows use keywords alone.");
      else if (budgetSpent) ctx.log(`Not topping up with AI — ${budgetSpent}.`);
    }

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    const machineId = active.length > 0 ? (await client.getIdentity()).machineIdentifier : "";
    const sections = await resolveTargetSections(client, getConfig, cfg.sections);
    const children = new Map<string, Promise<string[]>>();
    const childrenOf = (key: string) => {
      let pending = children.get(key);
      if (!pending) {
        pending = client.getCollectionChildren(key, { smart: false }).then((items) => items.map((i) => i.ratingKey));
        children.set(key, pending);
      }
      return pending;
    };

    async function deleteRow(row: Row, why: string): Promise<void> {
      ctx.log(`Deleting "${displayTitle(row.title)}" (${row.ratingKey}) — ${why}.`);
      await client.deleteItem(row.ratingKey);
      forgetCollections([row.ratingKey]);
    }

    /** Make the row hold exactly `ratingKeys`, editing it in place when it exists under this title. */
    async function writeRow(
      section: PlexSection,
      existing: Row | undefined,
      title: string,
      labels: string[],
      ratingKeys: string[],
      summary: string,
      pinWith: PinOptions,
    ): Promise<void> {
      const name = displayTitle(title);
      // A renamed season, or a row from another mode: its title is wrong and a
      // title can't be edited without moving the tag every item carries, so
      // it is replaced.
      if (existing && existing.title !== title) {
        await deleteRow(existing, `rebuilding it as "${name}"`);
        existing = undefined;
      }
      let collectionKey: string;
      if (existing) {
        collectionKey = existing.ratingKey;
        const current = await childrenOf(collectionKey);
        const wanted = new Set(ratingKeys);
        const have = new Set(current);
        const add = ratingKeys.filter((k) => !have.has(k));
        const remove = current.filter((k) => !wanted.has(k));
        await client.addCollectionItems(collectionKey, machineId, add);
        for (const key of remove) await client.removeCollectionItem(collectionKey, key);
        await client.updateCollection(collectionKey, { summary });
        ctx.log(`Updated "${name}": ${add.length} added, ${remove.length} removed.`);
      } else {
        const created = await client.createCollectionWithLabel(
          section.key,
          section.type,
          machineId,
          title,
          ratingKeys,
          labels,
        );
        if (!created) return;
        collectionKey = created;
        await client.updateCollection(collectionKey, { summary });
        // Pinned on creation only, so a row someone moved or hid stays where
        // they put it for the rest of the season.
        if (pin) await client.pinToHomepage(section.key, collectionKey, pinWith);
        ctx.log(`Created "${name}" (${ratingKeys.length} titles).`);
      }
      try {
        await upsertCollectionByKey(client, section, collectionKey);
      } catch (err) {
        ctx.log(`Failed to sync "${name}" to local DB: ${errorMessage(err)}`);
      }
    }

    /**
     * Everything that belongs in `season`'s row in this library, best first:
     * keyword matches, then — when those are short — what the rows already
     * hold, then the model's picks.
     */
    async function seasonPool(
      season: ResolvedSeason,
      section: PlexSection,
      library: Library,
      matched: string[],
      rows: Row[],
      promptRoom: () => Promise<number | undefined>,
    ): Promise<string[]> {
      const where = `${season.name} — "${section.title}"`;
      let pool = rankCandidates(matched, library.info);
      ctx.log(`${where}: ${pool.length} title(s) filed under its keywords.`);
      if (pool.length >= minItems) return pool;

      const own = rows.filter((r) => rowIdentity(r.labels)?.season === season.key);
      if (own.length > 0) {
        const kept = new Set<string>();
        for (const row of own)
          for (const key of await childrenOf(row.ratingKey)) if (library.keys.has(key)) kept.add(key);
        const before = pool.length;
        pool = [
          ...pool,
          ...rankCandidates(
            [...kept].filter((k) => !pool.includes(k)),
            library.info,
          ),
        ];
        if (pool.length > before) ctx.log(`${where}: kept ${pool.length - before} title(s) already in the row.`);
        if (pool.length >= minItems) return pool;
      }

      const model = llm;
      if (!model) return pool;
      const lines = library.items.map((i) => itemLabel(i)).join("\n");
      const block = `You are a movie/TV curator. Below is the full list of titles in a Plex "${section.title}" library.\n\n<library>\n${lines}\n</library>`;
      const prompt = seasonPrompt(season, maxItems);
      const room = await promptRoom();
      if (room !== undefined && estimateTokens(block) + estimateTokens(prompt) > room) {
        ctx.log(`${where}: the library is too long for ${model.model} to read; keywords alone.`);
        return pool;
      }
      try {
        const text = await askModel(model, ctx, block, prompt);
        const answer = parseSeasonAnswer(text);
        if (!answer) {
          ctx.log(`${where}: the model's answer wasn't the JSON asked for; keywords alone.`);
          return pool;
        }
        const match = libraryTitleMatcher(library.items);
        const picks = answer.map((t) => match(t.trim())).filter((k): k is string => Boolean(k));
        const before = pool.length;
        pool = [...pool, ...picks.filter((k, i) => !pool.includes(k) && picks.indexOf(k) === i)];
        ctx.log(
          `${where}: the model named ${answer.length}, ${picks.length} in the library; ${pool.length - before} added.`,
        );
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        if (err instanceof LlmBudgetExceededError) {
          ctx.log(`Not topping up with AI any further — ${errorMessage(err)}.`);
          llm = null;
        } else {
          ctx.log(`${where}: the model call failed (${errorMessage(err)}); keywords alone.`);
        }
      }
      return pool;
    }

    const recommender = recommendations.status();
    const ranked = recommender.enabled && recommender.available;
    // Each person's history once, however many libraries and seasons.
    const tastes = new Map<string, ReturnType<typeof tasteOf>>();
    function tasteOf(user: TargetUser) {
      const titles = watchedTitles(db, historyUserIds(user), now() - HISTORY_DAYS * DAY_MS);
      return {
        history: titles.map((t) => ({ ratingKey: t.key, weight: titleWeight(t, now()) })),
        genres: titles.length > 0 ? buildTasteProfile(titles, now()).genres : [],
      };
    }

    /** `pool` in this person's order: the recommender's, else their genre shares, else the pool's own. */
    function orderFor(user: TargetUser, pool: string[], library: Library): string[] {
      let taste = tastes.get(user.username);
      if (!taste) tastes.set(user.username, (taste = tasteOf(user)));
      if (ranked && taste.history.length > 0) {
        const ranking = recommendations.shortlist({ history: taste.history, candidates: pool, limit: pool.length });
        // The recommender leaves out titles it has no vector for; they go
        // after the ones it could rank rather than out of the row.
        if ("ratingKeys" in ranking) return [...new Set([...ranking.ratingKeys, ...pool])];
      }
      return taste.genres.length > 0 ? rankByGenreShare(pool, library.genresByKey, taste.genres) : pool;
    }

    let step = 0;
    for (const section of sections) {
      ctx.progress(step++, sections.length, section.title);
      const rows: Row[] = (await client.getCollectionsWithLabels(section.key, { label: SEASON_LABEL })).filter((row) =>
        row.labels.some((l) => l.toLowerCase() === SEASON_LABEL.toLowerCase()),
      );
      const wanted = new Set<string>();

      if (active.length > 0) {
        const { items, tmdbToItem } = await indexItemsByTmdb(client, section.key);
        ctx.log(
          `"${section.title}": ${tmdbToItem.size}/${items.length} titles have a TMDb id; ${rows.length} existing row(s).`,
        );
        const mediaType: "movie" | "tv" = section.type === "show" ? "tv" : "movie";
        const details = await hydrateTmdbDetails(
          ctx,
          { apiKey: apiKey! },
          [...tmdbToItem.keys()].map((tmdbId) => ({ tmdbId, mediaType })),
        );
        const meta = indexMetadata(section.key);
        const library: Library = {
          items,
          keys: new Set(items.map((i) => i.ratingKey)),
          info: new Map(
            items.map((i) => [i.ratingKey, { rating: meta.rating.get(i.ratingKey) ?? null, year: i.year ?? null }]),
          ),
          genresByKey: meta.genres,
          titleOf: new Map(items.map((i) => [i.ratingKey, i.title])),
        };
        let budget: Promise<number | undefined> | undefined;
        // How much prompt the model takes, asked once per library and only if
        // a season actually needs topping up.
        const promptRoom = () => {
          const model = llm;
          budget ??= model
            ? (
                createLlmClient(model).promptBudget?.({ maxTokens: ANSWER_MAX_TOKENS }, ctx.signal) ??
                Promise.resolve(undefined)
              ).catch(() => undefined)
            : Promise.resolve(undefined);
          return budget;
        };

        for (const season of active) {
          ctx.signal.throwIfAborted();
          const ids = new Set(season.keywords.map((k) => k.id));
          const matched = [...tmdbToItem]
            .filter(([tmdbId]) => matchSeason(details.get(`${mediaType}:${tmdbId}`), ids))
            .map(([, item]) => item.ratingKey);
          const pool = await seasonPool(season, section, library, matched, rows, promptRoom);
          const where = `${season.name} — "${section.title}"`;
          if (pool.length < minItems) {
            ctx.log(`${where}: ${pool.length} title(s), fewer than ${minItems}; no row.`);
            continue;
          }
          const summary = `Here for ${season.name}: ${describeMonthDayWindow(season.activeFrom, season.activeTo)}.`;
          const seasonLabel = `${SEASON_KEY_PREFIX}${season.key}`;
          const existingFor = (user: string | null) =>
            rows.find((r) => {
              const id = rowIdentity(r.labels);
              return id?.season === season.key && id.user === user;
            });

          if (mode === "server") {
            wanted.add(rowId(season.key, null));
            await writeRow(
              section,
              existingFor(null),
              seasonRowTitle(season.name, season.key),
              [BASELINE_LABEL, SEASON_LABEL, seasonLabel],
              pool.slice(0, maxItems),
              summary,
              SHARED_PIN,
            );
            continue;
          }

          const personalName = personalSeasonName(season.name);
          for (const user of users) {
            ctx.signal.throwIfAborted();
            const prefs = getOptedInPreferencesByUsername(user.username);
            // "Not for me" in the portal names the row, as either name: not
            // wanted, so the sweep below takes it away.
            const declined = (prefs?.excludedCollections ?? []).some((t) => {
              const named = displayTitle(t).toLowerCase();
              return named === personalName.toLowerCase() || named === season.name.toLowerCase();
            });
            if (declined) {
              ctx.log(`${where}: ${user.name} said it wasn't for them.`);
              continue;
            }
            const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
            const theirs = pool.filter((k) => !excluded.has((library.titleOf.get(k) ?? "").toLowerCase()));
            if (theirs.length < minItems) {
              ctx.log(`${where}: ${theirs.length} title(s) for ${user.name} after their exclusions; no row.`);
              continue;
            }
            wanted.add(rowId(season.key, user.username));
            await writeRow(
              section,
              existingFor(user.username),
              personalRowTitle(personalName, user.username),
              personalRowLabels(user.username, SEASON_LABEL, seasonLabel),
              orderFor(user, theirs, library).slice(0, maxItems),
              summary,
              personalRowPin(user.isOwner),
            );
          }
        }
      }

      // Everything this job labelled that this run didn't write.
      const activeKeys = new Set(active.map((s) => s.key));
      for (const row of rows) {
        const id = rowIdentity(row.labels);
        if (id && wanted.has(rowId(id.season, id.user))) continue;
        const season = id && seasons.find((s) => s.key === id.season);
        const why = !id
          ? "it doesn't say which season it's for"
          : !season
            ? "its season was removed"
            : !season.enabled
              ? `${season.name} is switched off`
              : !activeKeys.has(season.key)
                ? `${season.name} is over`
                : (mode === "server") !== (id.user === null)
                  ? "it was made for the other mode"
                  : id.user && !users.some((u) => u.username === id.user)
                    ? `${id.user} isn't one of the users it's built for`
                    : "it has too few titles, or was declined";
        await deleteRow(row, why);
      }
    }

    ctx.progress(sections.length, sections.length, "Done");
    ctx.log("All done!");
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: SeasonCollectionsJobConfig): Promise<void> {
  return createSeasonCollectionsCommand(ctx.scope.resolve(ServicesToken), {
    now: ctx.scope.resolve(ClockToken),
  }).run(ctx, config);
}

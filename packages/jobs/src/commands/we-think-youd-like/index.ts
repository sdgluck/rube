/**
 * We Think You'd Like: one collection per person per library, chosen by the
 * AI from a profile of their whole recent history.
 *
 * Because You Watched answers "more like the last thing", one row per recent
 * title, so it only ever reflects the last few nights. This answers "what is
 * this person into" — which needs every play in the window weighed together,
 * so the profile is built locally (`profile.ts`) and the model is asked for one
 * list against it.
 *
 * Three choices that differ from BYW, each for a failure BYW has:
 *
 *  - **The row is updated in place**, not deleted and recreated. A row that
 *    changes a few titles a week should keep its rating key, its pin and
 *    wherever the person moved it on their home screen.
 *  - **A bad answer changes nothing.** Too few matches, unparseable JSON or a
 *    failed call leaves last week's row exactly as it was, rather than
 *    replacing a good row with nothing.
 *  - **The library is the cached prefix and is the same for everyone.**
 *    Watched titles are removed after the answer, not before the call, because
 *    a per-person candidate list would make every call a cache miss.
 *
 * With the built-in recommender on (`domains/recommendations`), the last of
 * those gives way: the library is ranked for each person locally and only the
 * closest `SHORTLIST` titles go to the model. That is per person, so it is a
 * cache miss every time — and still far cheaper, because ~150 lines replace
 * thousands. Without an AI provider the shortlist *is* the row, which is what
 * lets this run on a server with no AI at all.
 */
import { WTYL_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createLlmClient, estimateTokens, type LlmConfig } from "@tinkerbell/llm";
import {
  displayTitle,
  errorMessage,
  personalRowTitle,
  preferencesPromptBlock,
  type UserPreferences,
} from "@tinkerbell/core";
import { LlmBudgetExceededError } from "@tinkerbell/domain.ai-usage";
import { createPlexClient, type PlexClient, type PlexItem, type PlexSection } from "@tinkerbell/plex";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { mediaItems, plexUsers } from "@tinkerbell/db";
import type { JobContext, WtylJobConfig } from "@tinkerbell/core";
import {
  extractJSON,
  itemLabel,
  libraryTitleMatcher,
  plexConnection,
  resolveTargetSections,
} from "../ai-collection-shared.ts";
import {
  keepOffRecommended,
  personalRowLabels,
  personalRowPin,
  repairPersonalRow,
} from "../../personalize/personal-row.ts";
import { describeSkip } from "@tinkerbell/domain.recommendations";
import { createRecommenderLog, topTitles } from "../recommender-log.ts";
import {
  buildTasteProfile,
  everWatchedKeys,
  historyUserIds,
  tasteProfilePromptBlock,
  titleWeight,
  watchedTitles,
  type TasteProfile,
} from "./profile.ts";

export const WTYL_LABEL = "WeThinkYoudLike";
export const WTYL_ROW_NAME = "We Think You'd Like";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Asked for this many more than `maxItems`. Picks the person has already seen
 * are dropped after the answer (see the header), and asking for exactly
 * `maxItems` would come up short every time.
 */
const OVERSHOOT = 10;
/** Genres per library line: enough for the model to place an unfamiliar title, few enough to keep the prefix small. */
const LINE_GENRES = 3;
/** The answer's token budget, which the model's window has to leave room for. */
const ANSWER_MAX_TOKENS = 2048;
/**
 * How many of the recommender's best-ranked titles the model reranks. Enough
 * that the model has real choices to make about tone and theme — the thing it
 * is better at than the vectors — and few enough to fit any local model.
 */
const SHORTLIST = 150;

const answerSchema = z.object({
  summary: z.string(),
  items: z.array(z.string()),
});
export type WtylAnswer = z.infer<typeof answerSchema>;

const ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" }, items: { type: "array", items: { type: "string" } } },
  required: ["summary", "items"],
};

interface TargetUser {
  userId: number;
  username: string;
  name: string;
  isOwner: boolean;
}

interface SectionState {
  section: PlexSection;
  items: PlexItem[];
  /** The fenced library, identical for every person — the cacheable prefix. */
  library: string;
  genresByKey: Map<string, string[]>;
  match: (title: string) => string | undefined;
  rows: Array<{ ratingKey: string; title: string; labels: string[] }>;
  titleOf: Map<string, string>;
}

/** This person's row in a section's WTYL listing, if they have one. */
export function ownWtylRow<T extends { labels: string[] }>(rows: T[], username: string): T | undefined {
  return rows.find(
    (row) =>
      row.labels.some((l) => l.toLowerCase() === WTYL_LABEL.toLowerCase()) &&
      row.labels.some((l) => l === `User:${username}`),
  );
}

/**
 * The library as the model reads it: `Title (Year) — Genre, Genre` per line.
 * The genres come free from the local index and let the model place a title
 * it doesn't recognise. Fenced like BYW's: titles are user-controlled.
 */
function libraryLine(item: PlexItem, genresByKey: Map<string, string[]>): string {
  const genres = (genresByKey.get(item.ratingKey) ?? []).slice(0, LINE_GENRES);
  return genres.length > 0 ? `${itemLabel(item)} — ${genres.join(", ")}` : itemLabel(item);
}

export function wtylLibraryBlock(
  sectionTitle: string,
  items: PlexItem[],
  genresByKey: Map<string, string[]>,
  opts: { shortlisted?: boolean } = {},
): string {
  const lines = items
    .map((item) => libraryLine(item, genresByKey))
    .join("\n")
    .replace(/<\/?library>/gi, (m) => m.replace(">", "_>"));
  const intro = opts.shortlisted
    ? `the titles in a Plex "${sectionTitle}" library that best fit this viewer's history, closest first, each with its genres`
    : `the full list of titles in a Plex "${sectionTitle}" library, each with its genres`;
  return `You are a movie/TV curator. Below is ${intro}.

<library>
${lines}
</library>`;
}

/**
 * The part of a library that fits `budget` tokens, for a model whose window
 * can't hold the whole of it — a local model with 40k of context was refused
 * every call for a 4,000-film library, which with genres needs nearly 70k.
 * What they've watched goes first (it is removed from the answer anyway),
 * then the titles furthest from their taste, scored by their genre shares.
 * The rest keep the library's order. Everyone shares the whole library as
 * the cached prefix when it fits; a cut one is per person, so it costs the
 * cache — but a call that runs beats one that can't.
 */
export function fitLibrary(opts: {
  items: PlexItem[];
  genresByKey: Map<string, string[]>;
  genreShares: Array<{ name: string; share: number }>;
  watched: Set<string>;
  budget: number;
}): PlexItem[] {
  const share = new Map(opts.genreShares.map((g) => [g.name, g.share]));
  const score = (item: PlexItem) =>
    (opts.genresByKey.get(item.ratingKey) ?? []).reduce((sum, g) => sum + (share.get(g) ?? 0), 0);
  const ranked = opts.items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter(({ item }) => !opts.watched.has(item.ratingKey))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const kept: typeof ranked = [];
  let used = 0;
  for (const entry of ranked) {
    const cost = estimateTokens(`${libraryLine(entry.item, opts.genresByKey)}\n`);
    if (used + cost > opts.budget) break;
    used += cost;
    kept.push(entry);
  }
  return kept.sort((a, b) => a.index - b.index).map(({ item }) => item);
}

export function wtylPrompt(opts: {
  profile: TasteProfile;
  prefs: UserPreferences | undefined;
  minItems: number;
  maxItems: number;
}): string {
  const want = opts.maxItems + OVERSHOOT;
  return `Recommend titles from the library above for one viewer, based on their watch history.

${tasteProfilePromptBlock(opts.profile)}
${opts.prefs ? preferencesPromptBlock(opts.prefs) : ""}
Rules:
- Read the history for what connects it: themes, tone, pacing, eras, the kind of story — not only the genre percentages
- Pick between ${opts.minItems} and ${want} titles, best fit first
- Only use titles from the library list, written exactly as "Title (Year)" without the genres
- Do NOT pick anything listed in their history
- Avoid what resembles the titles they gave up on
- Mix close matches with a few that stretch their taste in a direction it already leans
- "summary" is one or two sentences, addressed to the viewer, on what ties the picks to their taste — e.g. "Slow-burn sci-fi and dry British comedy, with the odd 80s action film." No title names, no preamble.

Return ONLY valid minified JSON on a single line, no markdown fences, no explanation. Format:
{"summary":"...","items":["Title (Year)","Title (Year)"]}`;
}

/**
 * The row's description when there is no model to write one: what the profile
 * says they watch, in the shape the prompt asks the model for.
 */
export function wtylFallbackSummary(profile: TasteProfile): string {
  const genres = profile.genres.slice(0, 3).map((g) => g.name);
  if (genres.length === 0) return "Picked from what you've been watching lately.";
  const list = genres.length === 1 ? genres[0] : `${genres.slice(0, -1).join(", ")} and ${genres.at(-1)}`;
  const decade = profile.decades[0];
  return `Picked from what you've been watching lately: mostly ${list}${
    decade && decade.share >= 0.4 ? `, often from the ${decade.decade}s` : ""
  }.`;
}

/** The model's answer, or why it can't be used. */
export function parseWtylAnswer(text: string): { answer: WtylAnswer } | { error: string } {
  const parsed = extractJSON(text);
  if (parsed === null) return { error: "the answer wasn't parseable JSON" };
  const result = answerSchema.safeParse(Array.isArray(parsed) ? parsed[0] : parsed);
  if (!result.success) return { error: `the answer had the wrong shape: ${result.error.message}` };
  return { answer: result.data };
}

/**
 * The answer's titles as rating keys, in the model's order: unmatched,
 * repeated, already-watched and excluded titles dropped, then cut to size. A
 * line copied back with its genres still attached is matched without them.
 */
export function pickRatingKeys(opts: {
  items: string[];
  match: (title: string) => string | undefined;
  watched: Set<string>;
  excludedTitles: string[];
  titleOf: Map<string, string>;
  maxItems: number;
}): string[] {
  const excluded = new Set(opts.excludedTitles.map((t) => t.toLowerCase()));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const raw of opts.items) {
    const title = raw.replace(/\s+—\s+.*$/, "").trim();
    const key = opts.match(title);
    if (!key || seen.has(key) || opts.watched.has(key)) continue;
    if (excluded.has((opts.titleOf.get(key) ?? "").toLowerCase())) continue;
    seen.add(key);
    picked.push(key);
    if (picked.length >= opts.maxItems) break;
  }
  return picked;
}

/**
 * The model's picks first, then the recommender's ranking in order, up to
 * `max`. The shortlist already leaves out what they've seen and what they've
 * excluded, so anything taken from it is as usable as a pick.
 */
export function topUpPicks(picks: string[], shortlist: string[], max: number): string[] {
  const out = picks.slice(0, max);
  const have = new Set(out);
  for (const key of shortlist) {
    if (out.length >= max) break;
    if (!have.has(key)) {
      out.push(key);
      have.add(key);
    }
  }
  return out;
}

export function createWeThinkYoudLikeCommand(
  deps: Pick<
    Services,
    "aiUsage" | "clients" | "collections" | "config" | "db" | "health" | "preferences" | "recommendations"
  >,
) {
  const { aiUsage, clients, collections, config, db, health, preferences, recommendations } = deps;
  const { track, budgetExceededReason } = aiUsage;
  const { plexHealthCallback } = clients;
  const { getConfig, getLlmConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;
  const { reportHealth } = health;
  const { upsertCollectionByKey, forgetCollections } = collections;

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

  /** The index's genres for a section, by rating key. */
  function sectionGenres(sectionId: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const row of db
      .select({ ratingKey: mediaItems.ratingKey, genres: mediaItems.genres })
      .from(mediaItems)
      .where(eq(mediaItems.sectionId, sectionId))
      .all()) {
      if (row.genres?.length) map.set(row.ratingKey, row.genres);
    }
    return map;
  }

  /**
   * How far back to read. Playback retention prunes the session log, so a
   * window longer than it reads less than it says — logged, because a
   * profile from one month of a "365 day" window is otherwise a mystery.
   */
  function historySince(ctx: JobContext, historyDays: number, now: number): number {
    const retention = getConfig("playback_retention_days") ?? 0;
    if (retention > 0 && retention < historyDays) {
      ctx.log(
        `History window is ${historyDays} days, but playback retention keeps ${retention}; reading ${retention}.`,
      );
    }
    return now - historyDays * DAY_MS;
  }

  async function askModel(
    llmConfig: LlmConfig,
    ctx: Pick<JobContext, "log" | "signal">,
    library: string,
    prompt: string,
  ): Promise<string> {
    const client = track(createLlmClient(llmConfig), { feature: "we-think-youd-like" });
    try {
      const res = await client.complete({
        cacheablePrefix: library,
        prompt,
        maxTokens: ANSWER_MAX_TOKENS,
        jsonSchema: ANSWER_JSON_SCHEMA,
        signal: ctx.signal,
      });
      reportHealth("LLM", "ok", `${res.provider}:${res.model} — ${res.tokensIn} in, ${res.tokensOut} out`);
      return res.text;
    } catch (err) {
      if (!(err instanceof LlmBudgetExceededError)) reportHealth("LLM", "error", errorMessage(err));
      throw err;
    }
  }

  /**
   * Make the person's row hold exactly `ratingKeys`, creating it if needed.
   * An existing row is edited, never replaced — see the header.
   */
  async function writeRow(
    client: PlexClient,
    ctx: JobContext,
    machineId: string,
    state: SectionState,
    user: TargetUser,
    ratingKeys: string[],
    summary: string,
    pin: boolean,
  ): Promise<void> {
    const { section } = state;
    const title = personalRowTitle(WTYL_ROW_NAME, user.username);
    let existing = ownWtylRow(state.rows, user.username);
    // A row from before per-person titles shares its contents with everyone
    // else's (see `personal-title.ts`). Editing it would edit theirs too, so
    // it is replaced — once — by one under this person's own title.
    if (existing && existing.title !== title) {
      await deleteRow(client, ctx, existing.ratingKey, `rebuilding it under ${user.name}'s own title`);
      existing = undefined;
    }
    let collectionKey: string;
    if (existing) {
      collectionKey = existing.ratingKey;
      const current = (await client.getCollectionChildren(collectionKey, { smart: false })).map((i) => i.ratingKey);
      const wanted = new Set(ratingKeys);
      const have = new Set(current);
      const add = ratingKeys.filter((k) => !have.has(k));
      const remove = current.filter((k) => !wanted.has(k));
      await client.addCollectionItems(collectionKey, machineId, add);
      for (const key of remove) await client.removeCollectionItem(collectionKey, key);
      await client.updateCollection(collectionKey, { summary });
      ctx.log(`Updated "${WTYL_ROW_NAME}" for ${user.name}: ${add.length} added, ${remove.length} removed.`);
    } else {
      const created = await client.createCollectionWithLabel(
        section.key,
        section.type,
        machineId,
        title,
        ratingKeys,
        personalRowLabels(user.username, WTYL_LABEL),
      );
      if (!created) return;
      collectionKey = created;
      await client.updateCollection(collectionKey, { summary });
      // Pinned once, on creation. Re-pinning every week would undo wherever
      // the person has since moved or hidden it.
      if (pin) {
        await client.pinToHomepage(section.key, collectionKey, personalRowPin(user.isOwner));
      }
      ctx.log(`Created "${WTYL_ROW_NAME}" for ${user.name} (${ratingKeys.length} items).`);
    }
    try {
      await upsertCollectionByKey(client, section, collectionKey);
    } catch (err) {
      ctx.log(`Failed to sync "${WTYL_ROW_NAME}" to local DB: ${errorMessage(err)}`);
    }
  }

  async function deleteRow(client: PlexClient, ctx: JobContext, ratingKey: string, why: string): Promise<void> {
    ctx.log(`Deleting "${WTYL_ROW_NAME}" (${ratingKey}) — ${why}.`);
    await client.deleteItem(ratingKey);
    forgetCollections([ratingKey]);
  }

  async function run(ctx: JobContext, config: WtylJobConfig): Promise<void> {
    const { url, token } = plexConnection(getConfig);
    const llmConfig = getLlmConfig();
    const historyDays = config.historyDays ?? WTYL_DEFAULTS.historyDays;
    const minHistoryTitles = config.minHistoryTitles ?? WTYL_DEFAULTS.minHistoryTitles;
    const pin = config.pinToHomepage ?? WTYL_DEFAULTS.pinToHomepage;
    const minItems = config.minItems ?? WTYL_DEFAULTS.minItems;
    const maxItems = config.maxItems ?? WTYL_DEFAULTS.maxItems;
    const minLibrarySize = config.minLibrarySize ?? WTYL_DEFAULTS.minLibrarySize;
    const allowlist = config.users ?? [];

    const recommender = recommendations.status();
    const ranked = recommender.enabled && recommender.available;

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    if (!llmConfig && !ranked) {
      throw new Error(
        "No AI provider is configured. Set one in Settings → AI, or turn on the built-in recommender there.",
      );
    }

    // A spent budget stops the model, not the row: with the recommender on,
    // the shortlist alone is still a row worth having.
    const budgetSpent = llmConfig ? budgetExceededReason() : null;
    if (budgetSpent && !ranked) {
      ctx.log(`Skipping — ${budgetSpent}. Existing collections are left as they are.`);
      return;
    }
    const llm = budgetSpent ? null : llmConfig;
    if (ranked) {
      ctx.log(
        llm
          ? `Ranking with the built-in recommender; ${llm.model} picks from each person's closest ${SHORTLIST}.`
          : `Ranking with the built-in recommender alone${budgetSpent ? ` — ${budgetSpent}` : ""}.`,
      );
    }

    const users = targetUsers(allowlist);
    if (users.length === 0) {
      throw new Error(
        allowlist.length > 0
          ? `No matching users found for allowlist: ${allowlist.join(", ")}`
          : "No users synced yet — run Sync users, or refresh the Users page.",
      );
    }

    const client = createPlexClient({ url, token, signal: ctx.signal, onHealth: plexHealthCallback });
    ctx.log(`tinkerbell we-think-youd-like`);
    ctx.log(`Server: ${url}`);
    const identity = await client.getIdentity();
    const machineId = identity.machineIdentifier;
    ctx.log(`Server name: ${identity.friendlyName}`);
    ctx.log(`Users: ${users.map((u) => u.name).join(", ")}`);

    // Each library once, up front: every person is matched against the same
    // list, and it is the same prompt prefix for all of them.
    const sections: SectionState[] = [];
    for (const section of await resolveTargetSections(client, getConfig, config.sections)) {
      const items = await client.fetchAllItems(section.key);
      if (items.length < minLibrarySize) {
        ctx.log(`"${section.title}": too few items (${items.length} < ${minLibrarySize}), skipping.`);
        continue;
      }
      const genresByKey = sectionGenres(section.key);
      const rows = (await client.getCollectionsWithLabels(section.key, { label: WTYL_LABEL })).filter((row) =>
        row.labels.some((l) => l.toLowerCase() === WTYL_LABEL.toLowerCase()),
      );
      sections.push({
        section,
        items,
        library: wtylLibraryBlock(section.title, items, genresByKey),
        genresByKey,
        match: libraryTitleMatcher(items),
        rows,
        titleOf: new Map(items.map((i) => [i.ratingKey, itemLabel(i)])),
      });
      ctx.log(`"${section.title}": ${items.length} item(s), ${rows.length} existing row(s).`);
    }
    if (sections.length === 0) {
      ctx.log("No library to build in.");
      return;
    }
    const recLog = createRecommenderLog(ctx.log, recommender);
    if (ranked) recLog.header(sections.map((s) => s.section.title));

    // How much prompt the model takes, asked once: undefined for a hosted
    // model, whose window dwarfs any library, and for an Ollama server that
    // doesn't say — that call is refused with the reason, as before.
    const promptBudget = llm
      ? await createLlmClient(llm)
          .promptBudget?.({ maxTokens: ANSWER_MAX_TOKENS }, ctx.signal)
          .catch(() => undefined)
      : undefined;

    const now = Date.now();
    const since = historySince(ctx, historyDays, now);
    const totalSteps = users.length * sections.length;
    let step = 0;

    for (const user of users) {
      // Before the history check, so a row made before `personal-row.ts` is
      // repaired even for someone who has watched too little to rebuild it.
      for (const state of sections) {
        const existing = ownWtylRow(state.rows, user.username);
        if (existing && (await repairPersonalRow(client, state.section.key, existing, { isOwner: user.isOwner, pin })))
          ctx.log(`Made "${WTYL_ROW_NAME}" in "${state.section.title}" visible to ${user.name} only.`);
        if (
          existing &&
          pin &&
          !user.isOwner &&
          (await keepOffRecommended(client, state.section.key, new Set([existing.ratingKey])))
        )
          ctx.log(
            `Took ${user.name}'s "${WTYL_ROW_NAME}" in "${state.section.title}" off the library's Recommended tab.`,
          );
      }
      const ids = historyUserIds(user);
      const titles = watchedTitles(db, ids, since);
      if (titles.length < minHistoryTitles) {
        ctx.log(
          `${user.name}: ${titles.length} title(s) watched in ${historyDays} days, fewer than ${minHistoryTitles} — skipping.`,
        );
        step += sections.length;
        continue;
      }
      const profile = buildTasteProfile(titles, now);
      const history = titles.map((t) => ({ ratingKey: t.key, weight: titleWeight(t, now) }));
      const watched = everWatchedKeys(db, ids);
      const prefs = getOptedInPreferencesByUsername(user.username);
      const excludedTitles = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
      ctx.log(
        `${user.name}: ${titles.length} title(s); top genres ${profile.genres
          .slice(0, 3)
          .map((g) => g.name)
          .join(", ")}${prefs ? "; applying their preferences" : ""}.`,
      );

      // "Not for me" in the portal names the row; honour it by taking the row
      // away rather than rebuilding it every week.
      const declined = (prefs?.excludedCollections ?? []).some(
        (t) => displayTitle(t).toLowerCase() === WTYL_ROW_NAME.toLowerCase(),
      );
      const prompt = wtylPrompt({ profile, prefs, minItems, maxItems });

      for (const state of sections) {
        step++;
        ctx.progress(step, totalSteps, `${user.name} — "${state.section.title}"`);
        const existing = ownWtylRow(state.rows, user.username);
        if (declined) {
          if (existing) await deleteRow(client, ctx, existing.ratingKey, `${user.name} said it wasn't for them`);
          continue;
        }

        const ranking = ranked
          ? recommendations.shortlist({
              history,
              candidates: state.items
                .filter((i) => !watched.has(i.ratingKey) && !excludedTitles.has(i.title.toLowerCase()))
                .map((i) => i.ratingKey),
              limit: llm ? SHORTLIST : maxItems,
            })
          : null;
        recLog.outcome(ranking);
        const shortlist = ranking && "ratingKeys" in ranking ? ranking.ratingKeys : null;
        const where = `${user.name} — "${state.section.title}"`;
        if (ranking && "ratingKeys" in ranking) {
          const used = ranking.history
            ? ` from ${ranking.history.used} of ${ranking.history.total} watched titles`
            : "";
          ctx.log(`${where}: ranked${used}; closest: ${topTitles(ranking.ratingKeys, state.titleOf)}.`);
        } else if (ranking) {
          ctx.log(
            `${where}: recommender skipped — ${describeSkip(ranking)}${llm ? "; sending the whole library" : ""}.`,
          );
        }

        if (!llm) {
          // `ranked` is the only way here without a model, so no shortlist is
          // the recommender declining (said just above) — and with nothing to
          // fall back to, the row stays as it is rather than being emptied.
          if (!shortlist || shortlist.length < minItems) {
            ctx.log(
              `${where}: ${
                shortlist ? `only ${shortlist.length} pick(s), need ${minItems}` : "nothing ranked"
              } and there's no AI to fall back on; row left as it is.`,
            );
            continue;
          }
          await writeRow(client, ctx, machineId, state, user, shortlist, wtylFallbackSummary(profile), pin);
          continue;
        }

        let library = state.library;
        if (shortlist) {
          const byKey = new Map(state.items.map((i) => [i.ratingKey, i]));
          library = wtylLibraryBlock(
            state.section.title,
            shortlist.map((k) => byKey.get(k)!),
            state.genresByKey,
            { shortlisted: true },
          );
        } else if (promptBudget !== undefined) {
          const room =
            promptBudget -
            estimateTokens(prompt) -
            estimateTokens(wtylLibraryBlock(state.section.title, [], state.genresByKey));
          if (estimateTokens(library) > room) {
            const fitted = fitLibrary({
              items: state.items,
              genresByKey: state.genresByKey,
              genreShares: profile.genres,
              watched,
              budget: room,
            });
            library = wtylLibraryBlock(state.section.title, fitted, state.genresByKey);
            ctx.log(
              `${user.name} — "${state.section.title}": the library is too long for ${llm.model}; sending the ${fitted.length} of ${state.items.length} titles closest to their taste.`,
            );
          }
        }

        // With a shortlist, the model is choosing from titles already ranked
        // for this person, so a short answer — a small local model repeating
        // one title eight times, or not answering at all — is filled from the
        // ranking rather than leaving last week's row. Without one there is
        // nothing to fill from, and a bad answer still changes nothing.
        let answer: WtylAnswer | null = null;
        let failure: string | null = null;
        try {
          const text = await askModel(llm, ctx, library, prompt);
          ctx.log("AI response:", text);
          const parsed = parseWtylAnswer(text);
          if ("error" in parsed) failure = parsed.error;
          else answer = parsed.answer;
        } catch (err) {
          // Cancelled: every later call would fail the same way, so stop
          // rather than log one per person and then claim to be done.
          if (ctx.signal.aborted) throw err;
          if (err instanceof LlmBudgetExceededError) {
            ctx.log(`Stopping — ${errorMessage(err)}. Existing collections are left as they are.`);
            return;
          }
          failure = `the model call failed (${errorMessage(err)})`;
        }
        if (failure && !shortlist) {
          ctx.log(`${user.name} — "${state.section.title}": ${failure}; row left as it is.`);
          continue;
        }
        if (answer && shortlist) {
          const inShortlist = new Set(shortlist);
          let fromShortlist = 0;
          let elsewhere = 0;
          let unmatched = 0;
          for (const raw of answer.items) {
            const key = state.match(raw.replace(/\s+—\s+.*$/, "").trim());
            if (!key) unmatched++;
            else if (inShortlist.has(key)) fromShortlist++;
            else elsewhere++;
          }
          ctx.log(
            `${user.name} — "${state.section.title}": the model chose ${answer.items.length}: ${fromShortlist} from the shortlist, ${elsewhere} elsewhere in the library, ${unmatched} not in the library.`,
          );
        }
        let ratingKeys = answer
          ? pickRatingKeys({
              items: answer.items,
              match: state.match,
              watched,
              excludedTitles: prefs?.excludedTitles ?? [],
              titleOf: new Map(state.items.map((i) => [i.ratingKey, i.title])),
              maxItems,
            })
          : [];
        if (shortlist && ratingKeys.length < maxItems) {
          const fromModel = ratingKeys.length;
          ratingKeys = topUpPicks(ratingKeys, shortlist, maxItems);
          ctx.log(
            `${user.name} — "${state.section.title}": ${failure ? `${failure}; ` : ""}${fromModel} usable pick(s) from the model, filled to ${ratingKeys.length} from the recommender's ranking.`,
          );
        }
        if (ratingKeys.length < minItems) {
          ctx.log(
            `${user.name} — "${state.section.title}": only ${ratingKeys.length} usable pick(s), need ${minItems}; row left as it is.`,
          );
          continue;
        }
        const summary = answer?.summary.trim() || wtylFallbackSummary(profile);
        await writeRow(client, ctx, machineId, state, user, ratingKeys, summary, pin);
      }
    }

    // Rows for people no longer on the Users page. Not when an allowlist is
    // set: narrowing it is a choice about who gets a *new* row, and deleting
    // everyone else's on the next run would be a surprise.
    if (allowlist.length === 0) {
      const known = new Set(users.map((u) => `User:${u.username}`));
      for (const state of sections) {
        for (const row of state.rows) {
          const owner = row.labels.find((l) => l.startsWith("User:"));
          if (owner && !known.has(owner))
            await deleteRow(client, ctx, row.ratingKey, `${owner.slice(5)} is no longer a user`);
        }
      }
    }

    recLog.footer();
    ctx.log("All done!");
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: WtylJobConfig): Promise<void> {
  return createWeThinkYoudLikeCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}

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
 */
import { WTYL_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createLlmClient, type LlmConfig } from "@tinkerbell/llm";
import { errorMessage, preferencesPromptBlock, type UserPreferences } from "@tinkerbell/core";
import { LlmBudgetExceededError } from "@tinkerbell/domain.ai-usage";
import { createPlexClient, type PlexClient, type PlexItem, type PlexSection } from "@tinkerbell/plex";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { mediaItems, plexUsers } from "@tinkerbell/db";
import type { JobContext, WtylJobConfig } from "@tinkerbell/core";
import {
  extractJSON,
  itemLabel,
  libraryTitleMap,
  plexConnection,
  resolveTargetSections,
} from "../ai-collection-shared.ts";
import { personalRowLabels, personalRowPin, repairPersonalRow } from "../../personalize/personal-row.ts";
import {
  buildTasteProfile,
  everWatchedKeys,
  historyUserIds,
  tasteProfilePromptBlock,
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
  titleMap: Map<string, string>;
  rows: Array<{ ratingKey: string; title: string; labels: string[] }>;
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
export function wtylLibraryBlock(sectionTitle: string, items: PlexItem[], genresByKey: Map<string, string[]>): string {
  const lines = items
    .map((item) => {
      const genres = (genresByKey.get(item.ratingKey) ?? []).slice(0, LINE_GENRES);
      return genres.length > 0 ? `${itemLabel(item)} — ${genres.join(", ")}` : itemLabel(item);
    })
    .join("\n")
    .replace(/<\/?library>/gi, (m) => m.replace(">", "_>"));
  return `You are a movie/TV curator. Below is the full list of titles in a Plex "${sectionTitle}" library, each with its genres.

<library>
${lines}
</library>`;
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
  titleMap: Map<string, string>;
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
    const key = opts.titleMap.get(title);
    if (!key || seen.has(key) || opts.watched.has(key)) continue;
    if (excluded.has((opts.titleOf.get(key) ?? "").toLowerCase())) continue;
    seen.add(key);
    picked.push(key);
    if (picked.length >= opts.maxItems) break;
  }
  return picked;
}

export function createWeThinkYoudLikeCommand(
  deps: Pick<Services, "aiUsage" | "clients" | "collections" | "config" | "db" | "health" | "preferences">,
) {
  const { aiUsage, clients, collections, config, db, health, preferences } = deps;
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
        maxTokens: 2048,
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
    const existing = ownWtylRow(state.rows, user.username);
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
        WTYL_ROW_NAME,
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

    if (!token) throw new Error("Plex token is required. Configure it in Settings.");
    if (!llmConfig) throw new Error("LLM provider is not configured. Set one in Settings → AI.");

    const budgetSpent = budgetExceededReason();
    if (budgetSpent) {
      ctx.log(`Skipping — ${budgetSpent}. Existing collections are left as they are.`);
      return;
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
      const rows = (await client.getCollectionsWithLabels(section.key, { label: WTYL_LABEL })).filter((row) =>
        row.labels.some((l) => l.toLowerCase() === WTYL_LABEL.toLowerCase()),
      );
      sections.push({
        section,
        items,
        library: wtylLibraryBlock(section.title, items, sectionGenres(section.key)),
        titleMap: libraryTitleMap(items),
        rows,
      });
      ctx.log(`"${section.title}": ${items.length} item(s), ${rows.length} existing row(s).`);
    }
    if (sections.length === 0) {
      ctx.log("No library to build in.");
      return;
    }

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
      const watched = everWatchedKeys(db, ids);
      const prefs = getOptedInPreferencesByUsername(user.username);
      ctx.log(
        `${user.name}: ${titles.length} title(s); top genres ${profile.genres
          .slice(0, 3)
          .map((g) => g.name)
          .join(", ")}${prefs ? "; applying their preferences" : ""}.`,
      );

      // "Not for me" in the portal names the row; honour it by taking the row
      // away rather than rebuilding it every week.
      const declined = (prefs?.excludedCollections ?? []).some((t) => t.toLowerCase() === WTYL_ROW_NAME.toLowerCase());
      const prompt = wtylPrompt({ profile, prefs, minItems, maxItems });

      for (const state of sections) {
        step++;
        ctx.progress(step, totalSteps, `${user.name} — "${state.section.title}"`);
        const existing = ownWtylRow(state.rows, user.username);
        if (declined) {
          if (existing) await deleteRow(client, ctx, existing.ratingKey, `${user.name} said it wasn't for them`);
          continue;
        }

        let text: string;
        try {
          text = await askModel(llmConfig, ctx, state.library, prompt);
        } catch (err) {
          if (err instanceof LlmBudgetExceededError) {
            ctx.log(`Stopping — ${errorMessage(err)}. Existing collections are left as they are.`);
            return;
          }
          ctx.log(
            `${user.name} — "${state.section.title}": the model call failed (${errorMessage(err)}); row left as it is.`,
          );
          continue;
        }
        ctx.log("AI response:", text);

        const parsed = parseWtylAnswer(text);
        if ("error" in parsed) {
          ctx.log(`${user.name} — "${state.section.title}": ${parsed.error}; row left as it is.`);
          continue;
        }
        const ratingKeys = pickRatingKeys({
          items: parsed.answer.items,
          titleMap: state.titleMap,
          watched,
          excludedTitles: prefs?.excludedTitles ?? [],
          titleOf: new Map(state.items.map((i) => [i.ratingKey, i.title])),
          maxItems,
        });
        if (ratingKeys.length < minItems) {
          ctx.log(
            `${user.name} — "${state.section.title}": only ${ratingKeys.length} usable pick(s), need ${minItems}; row left as it is.`,
          );
          continue;
        }
        await writeRow(client, ctx, machineId, state, user, ratingKeys, parsed.answer.summary.trim(), pin);
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

    ctx.log("All done!");
  }

  return { run };
}

/** The command entrypoint the runner and the Sidequest worker call. */
export default function run(ctx: JobContext, config: WtylJobConfig): Promise<void> {
  return createWeThinkYoudLikeCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}

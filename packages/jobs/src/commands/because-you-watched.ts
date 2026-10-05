import { BYW_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createLlmClient, type LlmConfig } from "@tinkerbell/llm";
import { errorMessage } from "@tinkerbell/core";
import { LlmBudgetExceededError } from "@tinkerbell/domain.ai-usage";
import { createPlexClient, type PlexClient, type PlexItem } from "@tinkerbell/plex";

import { preferencesPromptBlock, type UserPreferences } from "@tinkerbell/core";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { jobs } from "@tinkerbell/db";
import type { JobContext, BywJobConfig } from "@tinkerbell/core";

const BYW_LABEL = "BecauseYouWatched";
const BYW_LABELS = ["Tinkerbell", BYW_LABEL];

const aiCollectionSchema = z.object({
  name: z.string(),
  items: z.array(z.string()),
});

type AiCollection = z.infer<typeof aiCollectionSchema>;

type ResolvedUser = { name: string; plexUsername: string; accountID: string | undefined };

/** One model call, as the Settings → AI tester shows it. */
export interface BywCallUsage {
  provider: string;
  model: string;
  tokensIn: number;
  tokensInCached: number | null;
  tokensOut: number;
  durationMs: number;
}

export interface BywPreviewRow {
  watchedTitle: string;
  rowName: string;
  /** A nightly run would skip the model call for this row and keep the existing one. */
  existsAlready: boolean;
  items: Array<{ title: string; matched: boolean }>;
  matchedCount: number;
  /** Whether a real run would create the row: enough items matched the library. */
  wouldCreate: boolean;
  error: string | null;
  usage: BywCallUsage | null;
}

export interface BywPreviewResult {
  sectionTitle: string;
  user: string | null;
  libraryTitles: number;
  minItems: number;
  rows: BywPreviewRow[];
}

/** The schema above, for a provider that can constrain decoding to it. */
const BYW_RESPONSE_SCHEMA = {
  type: "object",
  properties: { name: { type: "string" }, items: { type: "array", items: { type: "string" } } },
  required: ["name", "items"],
};

/** The row's name, fixed by the watched title — which is why it can be checked before any model call. */
export function bywRowName(watchedTitle: string): string {
  return `Because you watched ${watchedTitle}`;
}

/**
 * The rows this run owns: every because-you-watched row in server mode, only
 * this person's in per-user mode. The same set decides which calls to skip and
 * which rows cleanup may delete, so the two can't disagree about a row.
 */
export function ownBywRows<T extends { labels: string[] }>(collections: T[], plexUsername: string | undefined): T[] {
  return collections.filter(
    (col) =>
      col.labels.some((tag) => tag.toLowerCase() === BYW_LABEL.toLowerCase()) &&
      (plexUsername === undefined || col.labels.some((tag) => tag === `User:${plexUsername}`)),
  );
}

/**
 * Best-effort JSON extraction for LLM responses. Tries strict parse, then
 * the first bracketed object, then a cleaned variant (no trailing commas /
 * control chars), then the first bracketed array. Returns null when none
 * succeed; each catch is an intentional "try the next fallback".
 */
function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to bracketed-object extraction
  }

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      // fall through to cleaned variant
    }

    // eslint-disable-next-line no-control-regex
    const cleaned = objMatch[0].replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001f]/g, " ");
    try {
      return JSON.parse(cleaned);
    } catch {
      // fall through to bracketed-array extraction
    }
  }

  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]);
    } catch {
      // exhausted fallbacks; caller treats `null` as "couldn't parse"
    }
  }

  return null;
}

export function createBecauseYouWatchedCommand(
  deps: Pick<Services, "aiUsage" | "clients" | "collections" | "config" | "db" | "health" | "preferences">,
) {
  const { aiUsage, clients, collections, config, db, health, preferences } = deps;
  const { track, budgetExceededReason } = aiUsage;
  const { plexHealthCallback } = clients;
  const { getConfig, getLlmConfig } = config;
  const { getOptedInPreferencesByUsername } = preferences;
  const { reportHealth } = health;
  const { upsertCollectionByKey, forgetCollections } = collections;

  /** Server accounts, named the way per-user rows are labelled. */
  async function resolveUsers(client: PlexClient, machineId: string): Promise<ResolvedUser[]> {
    const accounts = await client.getAccounts();
    const sharings = await client.getSharings(machineId);
    const idToPlexUsername = new Map<string, string>();
    for (const s of sharings) {
      idToPlexUsername.set(String(s.userId), s.username);
    }
    const users: ResolvedUser[] = [];
    for (const account of accounts) {
      if (account.name) {
        const plexUsername = idToPlexUsername.get(account.id) || account.name;
        users.push({ name: account.name, plexUsername, accountID: account.id });
      }
    }
    return users;
  }

  /** The most recent distinct titles watched in a section, newest first, as the job names them. */
  async function recentlyWatched(
    client: PlexClient,
    accountID: string | undefined,
    sectionId: string,
    limit: number,
  ): Promise<string[]> {
    const history = await client.getWatchHistory({ accountID, librarySectionID: sectionId, limit: limit * 5 });
    const seen = new Set<string>();
    const titles: string[] = [];
    for (const item of history) {
      const key =
        item.type === "episode"
          ? `show:${item.grandparentRatingKey || item.grandparentTitle}`
          : `${item.type}:${item.ratingKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      titles.push(
        item.type === "episode" ? item.grandparentTitle! : `${item.title}${item.year ? ` (${item.year})` : ""}`,
      );
      if (titles.length >= limit) break;
    }
    return titles;
  }

  async function run(ctx: JobContext, config: BywJobConfig): Promise<void> {
    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
    const llmConfig = getLlmConfig();
    // Defaults shared with the settings form, so what it shows for an unset
    // field is what runs.
    const LIMIT = config.limit ?? BYW_DEFAULTS.limit;
    const MODE = config.mode ?? BYW_DEFAULTS.mode;
    const PIN_TO_HOMEPAGE = config.pinToHomepage ?? BYW_DEFAULTS.pinToHomepage;
    const MIN_ITEMS = config.minItems ?? BYW_DEFAULTS.minItems;
    const MAX_ITEMS = config.maxItems ?? BYW_DEFAULTS.maxItems;
    const MIN_LIBRARY_SIZE = config.minLibrarySize ?? BYW_DEFAULTS.minLibrarySize;
    const userAllowlist = (config.users ?? []).map((u) => u.toLowerCase());

    if (!PLEX_TOKEN) {
      throw new Error("Plex token is required. Configure it in Settings.");
    }

    if (!llmConfig) {
      throw new Error("LLM provider is not configured. Set one in Settings → AI.");
    }

    const budgetSpent = budgetExceededReason();
    if (budgetSpent) {
      ctx.log(`Skipping — ${budgetSpent}. Existing collections are left as they are.`);
      return;
    }

    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });

    ctx.log(`tinkerbell because-you-watched`);
    ctx.log(`Server: ${PLEX_URL}`);

    const identity = await client.getIdentity();
    const machineId = identity.machineIdentifier;
    ctx.log(`Server name: ${identity.friendlyName}`);

    ctx.log(`Mode: ${MODE}`);

    let resolvedUsers: ResolvedUser[] = [];

    if (MODE === "server") {
      resolvedUsers = [{ name: "", plexUsername: "", accountID: undefined }];
    } else {
      resolvedUsers = await resolveUsers(client, machineId);
      if (userAllowlist.length > 0) {
        resolvedUsers = resolvedUsers.filter(
          (u) => userAllowlist.includes(u.name.toLowerCase()) || userAllowlist.includes(u.plexUsername.toLowerCase()),
        );
        if (resolvedUsers.length === 0) {
          throw new Error(`No matching users found for allowlist: ${config.users?.join(", ")}`);
        }
      }
      if (resolvedUsers.length === 0) {
        throw new Error("No user accounts found.");
      }
      ctx.log(`Users: ${resolvedUsers.map((u) => u.name).join(", ")}`);
    }

    // Resolve target sections
    let allSections = await client.getSections();

    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
    }

    let targetSections;
    if (config.sections && config.sections.length > 0) {
      const names = config.sections.map((s) => s.trim().toLowerCase());
      targetSections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
      if (targetSections.length === 0) {
        throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
      }
    } else {
      targetSections = allSections;
    }

    ctx.log(`Sections: ${targetSections.map((s) => s.title).join(", ")}`);

    const totalSteps = targetSections.length * resolvedUsers.length;
    let step = 0;

    for (const user of resolvedUsers) {
      const isPerUser = MODE === "per-user" && !!user.name;
      if (isPerUser) {
        ctx.log(`Processing user: ${user.name}`);
      }

      const collectionLabels = isPerUser ? ["Tinkerbell", BYW_LABEL, `User:${user.plexUsername}`] : BYW_LABELS;
      const userPrefs = isPerUser ? getOptedInPreferencesByUsername(user.plexUsername) : undefined;
      if (userPrefs) ctx.log(`Applying ${user.name}'s preferences.`);

      for (const section of targetSections) {
        step++;
        ctx.progress(step, totalSteps, `Processing "${section.title}"${isPerUser ? ` for ${user.name}` : ""}...`);
        const sectionId = section.key;

        ctx.log(`"${section.title}"${isPerUser ? ` (${user.name})` : ""} — starting...`);

        ctx.log(`Fetching watch history...`);
        const watchedTitles = await recentlyWatched(client, user.accountID, sectionId, LIMIT);

        if (watchedTitles.length === 0) {
          ctx.log(`No watch history found, skipping.`);
          continue;
        }

        ctx.log(`Found ${watchedTitles.length} unique recently watched item(s).`);

        // Fetch all items in section
        ctx.log(`Fetching library items...`);
        const libraryItems = await client.fetchAllItems(sectionId);
        ctx.log(`Found ${libraryItems.length} item(s).`);

        if (libraryItems.length < MIN_LIBRARY_SIZE) {
          ctx.log(`Too few items (${libraryItems.length} < ${MIN_LIBRARY_SIZE}) to generate collections, skipping.`);
          continue;
        }

        // This person's rows as they stand, before any model call. A row that
        // already exists is kept as it is — the creation pass below has always
        // skipped an existing name — so asking the model to rebuild it bought
        // an answer that was then thrown away. With the ten most recent titles
        // mostly unchanged from one night to the next, that was most of the
        // job's calls, each carrying the whole library.
        const allCollections = await client.getCollectionsWithLabels(sectionId, { label: BYW_LABEL });
        const mine = ownBywRows(allCollections, isPerUser ? user.plexUsername : undefined);
        const existingNames = new Set(mine.map((col) => col.title.toLowerCase()));
        const keptNames = new Set<string>();

        ctx.log(`Asking the LLM for "Because you watched" collections...`);
        const aiCollections: AiCollection[] = [];
        for (let i = 0; i < watchedTitles.length; i++) {
          const title = watchedTitles[i];
          const rowName = bywRowName(title).toLowerCase();
          if (existingNames.has(rowName)) {
            ctx.log(`[${i + 1}/${watchedTitles.length}] "${bywRowName(title)}" already exists, keeping it.`);
            keptNames.add(rowName);
            continue;
          }
          ctx.log(`[${i + 1}/${watchedTitles.length}] Generating collection for "${title}"...`);
          try {
            const { collection: col } = await generateBYWCollection(
              llmConfig,
              ctx,
              title,
              libraryItems,
              section.title,
              MIN_ITEMS,
              MAX_ITEMS,
              userPrefs,
            );
            if (col) {
              aiCollections.push(col);
            }
          } catch (err) {
            // Stop outright rather than carry on with what was generated so
            // far: the cleanup below deletes every collection not regenerated
            // this run, so a budget that ran out half-way would tear down the
            // rest of this user's collections and replace them with nothing.
            if (err instanceof LlmBudgetExceededError) {
              ctx.log(`Stopping — ${errorMessage(err)}. Existing collections are left as they are.`);
              return;
            }
            ctx.log(`Failed to generate collection for "${title}": ${errorMessage(err)}`);
          }
        }
        ctx.log(`Got ${aiCollections.length} collection(s) from AI.`);

        const titleMap = new Map<string, string>();
        for (const item of libraryItems) {
          const key = `${item.title}${item.year ? ` (${item.year})` : ""}`;
          titleMap.set(key, item.ratingKey);
          titleMap.set(item.title, item.ratingKey);
        }

        const newCollectionNames = new Set<string>();
        for (const col of aiCollections) {
          const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];
          if (ratingKeys.length >= MIN_ITEMS) {
            newCollectionNames.add(col.name.toLowerCase());
          }
        }

        ctx.log(`Cleaning up old "because you watched" collections...`);
        let deleted = 0;
        for (const col of mine) {
          if (newCollectionNames.has(col.title.toLowerCase()) || keptNames.has(col.title.toLowerCase())) {
            ctx.log(`Keeping "${col.title}" (still relevant)`);
            continue;
          }
          ctx.log(`Deleting collection "${col.title}" (${col.ratingKey})`);
          await client.deleteItem(col.ratingKey);
          forgetCollections([col.ratingKey]);
          deleted++;
        }
        ctx.log(`Deleted ${deleted} old collection(s).`);

        let created = 0;
        for (const col of aiCollections) {
          const ratingKeys = col.items.map((title) => titleMap.get(title)).filter(Boolean) as string[];

          if (ratingKeys.length < MIN_ITEMS) {
            ctx.log(`Skipping "${col.name}" — only ${ratingKeys.length} matching item(s), need at least ${MIN_ITEMS}`);
            continue;
          }

          // This person's rows only. Matching every row in the section meant
          // the second person to watch a film never got its row: the first
          // person's had the same name.
          const existingCol = mine.find((c) => c.title.toLowerCase() === col.name.toLowerCase());
          if (existingCol) {
            ctx.log(`"${col.name}" already exists, skipping creation.`);
            created++;
            continue;
          }

          ctx.log(`Creating "${col.name}" (${ratingKeys.length} items)...`);

          const collectionKey = await client.createCollectionWithLabel(
            sectionId,
            section.type,
            machineId,
            col.name,
            ratingKeys,
            collectionLabels,
          );

          if (collectionKey) {
            if (PIN_TO_HOMEPAGE) {
              await client.pinToHomepage(sectionId, collectionKey, {
                promotedToOwnHome: 1,
                promotedToRecommendedHome: 1,
                promotedToSharedHome: 0,
              });
              ctx.log(`Pinned "${col.name}" to homepage`);
            }
            try {
              await upsertCollectionByKey(client, section, collectionKey);
            } catch (err) {
              ctx.log(`Failed to sync "${col.name}" to local DB: ${errorMessage(err)}`);
            }
            created++;
          }
        }

        ctx.log(`${created} collection(s) for "${section.title}"${isPerUser ? ` (${user.name})` : ""} (new + kept).`);
      }
    }

    ctx.log("All done!");
  }

  /**
   * One row's model call. Returns why there is no collection alongside the
   * null, and the call's usage, so the Settings → AI tester can show both
   * without a second code path that could drift from what the job does.
   */
  async function generateBYWCollection(
    llmConfig: LlmConfig,
    ctx: Pick<JobContext, "log" | "signal">,
    watchedTitle: string,
    libraryItems: PlexItem[],
    sectionTitle: string,
    minItems: number,
    maxItems: number,
    prefs?: UserPreferences,
    feature: "because-you-watched" | "because-you-watched-preview" = "because-you-watched",
  ): Promise<{ collection: AiCollection | null; skipped: string | null; usage: BywCallUsage | null }> {
    // A row this person has already said isn't for them: don't spend a model call
    // rebuilding it. The name is fixed, so it can be checked before anything else.
    const rowName = bywRowName(watchedTitle);
    const excludedRows = new Set((prefs?.excludedCollections ?? []).map((t) => t.toLowerCase()));
    if (excludedRows.has(rowName.toLowerCase())) {
      ctx.log(`Skipping "${rowName}" — the user said it wasn't for them.`);
      return { collection: null, skipped: "the user said this row wasn't for them", usage: null };
    }

    // Hard-exclude any titles the user never wants recommended before the
    // candidate list even reaches the model.
    const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
    const candidates =
      excluded.size > 0
        ? libraryItems.filter((i) => !excluded.has(i.title.toLowerCase()) && !excluded.has(watchedTitle.toLowerCase()))
        : libraryItems;
    // Titles are user-controlled; one containing the fence marker could close
    // the list early and have what follows read as instructions.
    const itemList = candidates
      .map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`)
      .join("\n")
      .replace(/<\/?library>/gi, (m) => m.replace(">", "_>"));
    const prefsBlock = prefs ? preferencesPromptBlock(prefs) : "";

    // The library comes first and the title last. Every call for this person
    // and section sends the same list, and a provider's prompt cache only
    // matches from the start of the prompt: with the title ahead of the list,
    // as it used to be, no two calls shared a prefix and each paid for the
    // whole library again. Nothing per-call may go in `library`.
    const library = `You are a movie/TV curator. Below is the full list of titles in a Plex "${sectionTitle}" library.

<library>
${itemList}
</library>`;

    const prompt = `Create a "Because you watched" collection from the library above.

Recently watched: ${watchedTitle}

Rules:
- Name the collection "${rowName}"
- The collection MUST have between ${minItems} and ${maxItems} items
- Only use titles that exactly match the library list above
- Do NOT include "${watchedTitle}" in the collection
- Pick items that are thematically similar: shared vibes, tonal similarities, narrative parallels, genre connections, visual motifs
- The collection should feel like a genuine recommendation, not just the same genre
${prefsBlock}
Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
{"name":"${rowName}","items":["Title (Year)","Title (Year)"]}`;

    const client = track(createLlmClient(llmConfig), { feature });
    let text: string;
    let usage: BywCallUsage;
    const started = performance.now();
    try {
      const res = await client.complete({
        cacheablePrefix: library,
        prompt,
        maxTokens: 1024,
        jsonSchema: BYW_RESPONSE_SCHEMA,
        signal: ctx.signal,
      });
      reportHealth("LLM", "ok", `${res.provider}:${res.model} — ${res.tokensIn} in, ${res.tokensOut} out`);
      text = res.text;
      usage = {
        provider: res.provider,
        model: res.model,
        tokensIn: res.tokensIn,
        tokensInCached: res.tokensInCached ?? null,
        tokensOut: res.tokensOut,
        durationMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      if (!(err instanceof LlmBudgetExceededError)) reportHealth("LLM", "error", errorMessage(err));
      throw err;
    }

    ctx.log("AI response:", text);

    const parsed = extractJSON(text);
    if (parsed === null) {
      ctx.log(`Skipping "${watchedTitle}" — could not extract JSON from AI response`);
      return { collection: null, skipped: "the answer wasn't parseable JSON", usage };
    }

    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const result = aiCollectionSchema.safeParse(obj);
    if (!result.success) {
      ctx.log(`Skipping "${watchedTitle}" — invalid AI response: ${result.error.message}`);
      return { collection: null, skipped: `the answer had the wrong shape: ${result.error.message}`, usage };
    }

    return { collection: result.data, skipped: null, usage };
  }

  /**
   * A because-you-watched pass for one person and one section that writes
   * nothing: the same history lookup, prompt and model call as the job, with
   * the answer matched against the library and returned instead of sent to
   * Plex.
   *
   * Several titles run back to back on purpose. The library is the cached
   * prefix, so the second and later calls are where caching shows up — or
   * visibly doesn't — in the numbers.
   */
  async function previewBecauseYouWatched(
    input: { sectionKey: string; plexUsername?: string; watchedTitle?: string; count?: number },
    signal: AbortSignal,
  ): Promise<BywPreviewResult> {
    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
    const llmConfig = getLlmConfig();
    if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");
    if (!llmConfig) throw new Error("LLM provider is not configured. Set one above.");

    // The job's own settings, so the preview builds the row a run would.
    const jobConfig = (db.select({ config: jobs.config }).from(jobs).where(eq(jobs.id, "because-you-watched")).get()
      ?.config ?? {}) as BywJobConfig;
    const minItems = jobConfig.minItems ?? BYW_DEFAULTS.minItems;
    const maxItems = jobConfig.maxItems ?? BYW_DEFAULTS.maxItems;

    const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN, signal, onHealth: plexHealthCallback });
    const sections = await client.getSections();
    const section = sections.find((s) => s.key === input.sectionKey);
    if (!section) throw new Error(`No library section with key ${input.sectionKey}.`);

    let user: ResolvedUser | undefined;
    if (input.plexUsername) {
      const identity = await client.getIdentity();
      const wanted = input.plexUsername.toLowerCase();
      user = (await resolveUsers(client, identity.machineIdentifier)).find(
        (u) => u.plexUsername.toLowerCase() === wanted || u.name.toLowerCase() === wanted,
      );
      if (!user) throw new Error(`No server account for "${input.plexUsername}".`);
    }
    const prefs = user ? getOptedInPreferencesByUsername(user.plexUsername) : undefined;

    const count = Math.min(Math.max(input.count ?? 1, 1), 3);
    const titles = input.watchedTitle?.trim()
      ? [input.watchedTitle.trim()]
      : await recentlyWatched(client, user?.accountID, section.key, count);
    if (titles.length === 0) {
      throw new Error(`No watch history in "${section.title}"${user ? ` for ${user.name}` : ""} to build from.`);
    }

    const libraryItems = await client.fetchAllItems(section.key);
    const existing = ownBywRows(
      await client.getCollectionsWithLabels(section.key, { label: BYW_LABEL }),
      user?.plexUsername,
    );
    const existingNames = new Set(existing.map((c) => c.title.toLowerCase()));
    const known = new Set<string>();
    for (const item of libraryItems) {
      known.add(`${item.title}${item.year ? ` (${item.year})` : ""}`);
      known.add(item.title);
    }

    const log = () => {};
    const rows: BywPreviewRow[] = [];
    for (const watchedTitle of titles) {
      const rowName = bywRowName(watchedTitle);
      const base = { watchedTitle, rowName, existsAlready: existingNames.has(rowName.toLowerCase()) };
      try {
        const { collection, skipped, usage } = await generateBYWCollection(
          llmConfig,
          { log, signal },
          watchedTitle,
          libraryItems,
          section.title,
          minItems,
          maxItems,
          prefs,
          "because-you-watched-preview",
        );
        const items = (collection?.items ?? []).map((title) => ({ title, matched: known.has(title) }));
        const matchedCount = items.filter((i) => i.matched).length;
        rows.push({
          ...base,
          items,
          matchedCount,
          wouldCreate: matchedCount >= minItems,
          error: skipped,
          usage,
        });
      } catch (err) {
        rows.push({ ...base, items: [], matchedCount: 0, wouldCreate: false, error: errorMessage(err), usage: null });
      }
    }

    return {
      sectionTitle: section.title,
      user: user?.name ?? null,
      libraryTitles: libraryItems.length,
      minItems,
      rows,
    };
  }

  return { run, previewBecauseYouWatched };
}

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createBecauseYouWatchedCommand>["run"]>[1],
): Promise<void> {
  return createBecauseYouWatchedCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}

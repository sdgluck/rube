import { BYW_DEFAULTS } from "@tinkerbell/contracts";
import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createLlmClient, type LlmConfig } from "@tinkerbell/llm";
import { errorMessage } from "@tinkerbell/core";
import { LlmBudgetExceededError } from "@tinkerbell/domain.ai-usage";
import { createPlexClient, type PlexClient, type PlexItem } from "@tinkerbell/plex";

import { preferencesPromptBlock, type UserPreferences } from "@tinkerbell/core";

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { jobs, plexUsers } from "@tinkerbell/db";
import type { JobContext, BywJobConfig } from "@tinkerbell/core";
import type { PlexAccount } from "@tinkerbell/plex";
import { extractJSON, libraryTitleMap, plexConnection, resolveTargetSections } from "./ai-collection-shared.ts";
import { personalRowLabels, personalRowPin, repairPersonalRow } from "../personalize/personal-row.ts";

const BYW_LABEL = "BecauseYouWatched";
const BYW_LABELS = ["Tinkerbell", BYW_LABEL];

const aiCollectionSchema = z.object({
  name: z.string(),
  items: z.array(z.string()),
});

type AiCollection = z.infer<typeof aiCollectionSchema>;

type ResolvedUser = { name: string; plexUsername: string; accountID: string | undefined; isOwner?: boolean };

/** A recently watched title, as the row is named, and the Plex item its synopsis is read from — the show, for an episode. */
type Watched = { title: string; ratingKey: string | undefined };

/**
 * Long enough for any real synopsis; a cap only so a pasted essay in an
 * edited summary can't multiply the cost of every call.
 */
const SYNOPSIS_MAX_CHARS = 1500;

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
  /** The synopsis sent with the call, when the setting is on and Plex had one. */
  synopsis: string | null;
  items: Array<{ title: string; matched: boolean }>;
  matchedCount: number;
  /** Whether a real run would create the row: enough items matched the library. */
  wouldCreate: boolean;
  error: string | null;
  usage: BywCallUsage | null;
  /** The model's answer verbatim, so an unparseable or off-library reply can be read rather than guessed at. */
  response: string | null;
}

export interface BywPreviewResult {
  sectionTitle: string;
  user: string | null;
  libraryTitles: number;
  minItems: number;
  /** Whether each call was asked to send the watched title's synopsis. */
  includeSynopsis: boolean;
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
 * The watched title's synopsis as the prompt carries it, or nothing. Fenced
 * like the library: a summary is editable in Plex and must read as data, so a
 * closing tag inside it is defused rather than allowed to end the fence.
 */
export function bywSynopsisBlock(synopsis: string | null): string {
  if (!synopsis) return "";
  const fenced = synopsis.replace(/<\/?synopsis>/gi, (m) => m.replace(">", "_>"));
  return `\nWhat it's about:\n<synopsis>\n${fenced}\n</synopsis>\n`;
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

/** Because-you-watched rows labelled for someone outside `known` (a set of `User:<username>` labels). */
export function orphanedBywRows<T extends { labels: string[] }>(
  collections: T[],
  known: Set<string>,
): Array<T & { owner: string }> {
  const out: Array<T & { owner: string }> = [];
  for (const col of ownBywRows(collections, undefined)) {
    const owner = col.labels.find((l) => l.startsWith("User:"));
    if (owner && !known.has(owner)) out.push({ ...col, owner: owner.slice("User:".length) });
  }
  return out;
}

/**
 * Pair each user Tinkerbell knows with their server account. The users are
 * the Users page's list, not the server's `/accounts`: Plex keeps an account
 * there for anyone who ever played anything, so someone unshared months ago
 * still got a personal row built from their old history. `/accounts` only
 * supplies the id history is filed under — a shared user's is their plex.tv
 * id, but the owner's is a server-local `1`, found by name. A user with no
 * account has never played anything here; their plex.tv id finds no history,
 * which is the truth.
 */
export function matchKnownUsers(
  known: Array<{ userId: number; username: string }>,
  accounts: PlexAccount[],
): ResolvedUser[] {
  // String() both sides: Plex sends the id as a number despite the type.
  const byId = new Map(accounts.map((a) => [String(a.id), a]));
  const byName = new Map(accounts.filter((a) => a.name).map((a) => [a.name!.toLowerCase(), a]));
  return known.map((u) => {
    const account = byId.get(String(u.userId)) ?? byName.get(u.username.toLowerCase());
    return {
      name: account?.name || u.username,
      plexUsername: u.username,
      accountID: account ? String(account.id) : String(u.userId),
    };
  });
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

  /**
   * The users Tinkerbell knows — the Users page's `plex_users` — each matched
   * to the server-local account its watch history is filed under.
   */
  async function resolveUsers(client: PlexClient): Promise<ResolvedUser[]> {
    const known = db
      .select({ userId: plexUsers.userId, username: plexUsers.username, isOwner: plexUsers.isOwner })
      .from(plexUsers)
      .orderBy(asc(plexUsers.username))
      .all();
    if (known.length === 0) return [];
    const owners = new Set(known.filter((u) => u.isOwner === 1).map((u) => u.username));
    return matchKnownUsers(known, await client.getAccounts()).map((u) => ({
      ...u,
      isOwner: owners.has(u.plexUsername),
    }));
  }

  /** The most recent distinct titles watched in a section, newest first, as the job names them. */
  async function recentlyWatched(
    client: PlexClient,
    accountID: string | undefined,
    sectionId: string,
    limit: number,
  ): Promise<Watched[]> {
    const history = await client.getWatchHistory({ accountID, librarySectionID: sectionId, limit: limit * 5 });
    const seen = new Set<string>();
    const titles: Watched[] = [];
    for (const item of history) {
      const key =
        item.type === "episode"
          ? `show:${item.grandparentRatingKey || item.grandparentTitle}`
          : `${item.type}:${item.ratingKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      titles.push(
        item.type === "episode"
          ? { title: item.grandparentTitle!, ratingKey: item.grandparentRatingKey || undefined }
          : { title: `${item.title}${item.year ? ` (${item.year})` : ""}`, ratingKey: item.ratingKey },
      );
      if (titles.length >= limit) break;
    }
    return titles;
  }

  /**
   * What the watched title is about, from Plex. A name alone leaves the model
   * guessing for anything it doesn't know — an obscure film, a remake sharing
   * an older film's title — and a guess about the wrong film is a row of the
   * wrong recommendations. Best effort: no synopsis is the same call as
   * before the setting existed, not a reason to lose the row.
   */
  async function synopsisOf(
    client: PlexClient,
    ratingKey: string | undefined,
    log: (msg: string) => void,
  ): Promise<string | null> {
    if (!ratingKey) return null;
    try {
      const summary = (await client.getItemDetail(ratingKey)).summary.trim();
      return summary ? summary.slice(0, SYNOPSIS_MAX_CHARS) : null;
    } catch (err) {
      log(`Couldn't read the synopsis (${errorMessage(err)}); asking without it.`);
      return null;
    }
  }

  async function run(ctx: JobContext, config: BywJobConfig): Promise<void> {
    const { url: PLEX_URL, token: PLEX_TOKEN } = plexConnection(getConfig);
    const llmConfig = getLlmConfig();
    // Defaults shared with the settings form, so what it shows for an unset
    // field is what runs.
    const LIMIT = config.limit ?? BYW_DEFAULTS.limit;
    const MODE = config.mode ?? BYW_DEFAULTS.mode;
    const PIN_TO_HOMEPAGE = config.pinToHomepage ?? BYW_DEFAULTS.pinToHomepage;
    const MIN_ITEMS = config.minItems ?? BYW_DEFAULTS.minItems;
    const MAX_ITEMS = config.maxItems ?? BYW_DEFAULTS.maxItems;
    const MIN_LIBRARY_SIZE = config.minLibrarySize ?? BYW_DEFAULTS.minLibrarySize;
    const INCLUDE_SYNOPSIS = config.includeSynopsis ?? BYW_DEFAULTS.includeSynopsis;
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
      resolvedUsers = await resolveUsers(client);
      if (userAllowlist.length > 0) {
        resolvedUsers = resolvedUsers.filter(
          (u) => userAllowlist.includes(u.name.toLowerCase()) || userAllowlist.includes(u.plexUsername.toLowerCase()),
        );
        if (resolvedUsers.length === 0) {
          throw new Error(`No matching users found for allowlist: ${config.users?.join(", ")}`);
        }
      }
      if (resolvedUsers.length === 0) {
        throw new Error("No users synced yet — run Sync users, or refresh the Users page.");
      }
      ctx.log(`Users: ${resolvedUsers.map((u) => u.name).join(", ")}`);
    }

    const targetSections = await resolveTargetSections(client, getConfig, config.sections);

    ctx.log(`Sections: ${targetSections.map((s) => s.title).join(", ")}`);

    const totalSteps = targetSections.length * resolvedUsers.length;
    let step = 0;

    for (const user of resolvedUsers) {
      const isPerUser = MODE === "per-user" && !!user.name;
      if (isPerUser) {
        ctx.log(`Processing user: ${user.name}`);
      }

      const collectionLabels = isPerUser ? personalRowLabels(user.plexUsername, BYW_LABEL) : BYW_LABELS;
      // A server-wide row is for everyone, so every Home.
      const pinOptions = isPerUser
        ? personalRowPin(!!user.isOwner)
        : { promotedToOwnHome: 1, promotedToRecommendedHome: 1, promotedToSharedHome: 1 };
      const userPrefs = isPerUser ? getOptedInPreferencesByUsername(user.plexUsername) : undefined;
      if (userPrefs) ctx.log(`Applying ${user.name}'s preferences.`);

      for (const section of targetSections) {
        step++;
        ctx.progress(step, totalSteps, `Processing "${section.title}"${isPerUser ? ` for ${user.name}` : ""}...`);
        const sectionId = section.key;

        ctx.log(`"${section.title}"${isPerUser ? ` (${user.name})` : ""} — starting...`);

        // This person's rows as they stand, before any model call — and before
        // the skips below, so a row made before `personal-row.ts` is repaired
        // even for someone who has watched nothing here lately.
        const allCollections = await client.getCollectionsWithLabels(sectionId, { label: BYW_LABEL });
        const mine = ownBywRows(allCollections, isPerUser ? user.plexUsername : undefined);
        if (isPerUser) {
          for (const row of mine) {
            if (await repairPersonalRow(client, sectionId, row, { isOwner: !!user.isOwner, pin: PIN_TO_HOMEPAGE }))
              ctx.log(`Made "${row.title}" visible to ${user.name} only.`);
          }
        }

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

        // A row that already exists is kept as it is — the creation pass below
        // has always skipped an existing name — so asking the model to rebuild
        // it bought an answer that was then thrown away. With the ten most
        // recent titles mostly unchanged from one night to the next, that was
        // most of the job's calls, each carrying the whole library.
        const existingNames = new Set(mine.map((col) => col.title.toLowerCase()));
        const keptNames = new Set<string>();

        ctx.log(`Asking the LLM for "Because you watched" collections...`);
        const aiCollections: AiCollection[] = [];
        for (let i = 0; i < watchedTitles.length; i++) {
          const { title, ratingKey } = watchedTitles[i];
          const rowName = bywRowName(title).toLowerCase();
          if (existingNames.has(rowName)) {
            ctx.log(`[${i + 1}/${watchedTitles.length}] "${bywRowName(title)}" already exists, keeping it.`);
            keptNames.add(rowName);
            continue;
          }
          ctx.log(`[${i + 1}/${watchedTitles.length}] Generating collection for "${title}"...`);
          try {
            const synopsis = INCLUDE_SYNOPSIS ? await synopsisOf(client, ratingKey, ctx.log) : null;
            const { collection: col } = await generateBYWCollection(
              llmConfig,
              ctx,
              title,
              synopsis,
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

        const titleMap = libraryTitleMap(libraryItems);

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
              await client.pinToHomepage(sectionId, collectionKey, pinOptions);
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

    // Rows no person owns. Each run only ever looks at its users' own rows,
    // so a row labelled for someone since unshared — or with a display name,
    // as early versions wrote (`User:Hugh Blackwood`) — was never kept,
    // replaced or deleted, and sat in the library for good. Not when an
    // allowlist is set: that narrows who gets rows, not who may keep them.
    if (MODE === "per-user" && userAllowlist.length === 0) {
      const known = new Set(resolvedUsers.map((u) => `User:${u.plexUsername}`));
      for (const section of targetSections) {
        const rows = await client.getCollectionsWithLabels(section.key, { label: BYW_LABEL });
        for (const row of orphanedBywRows(rows, known)) {
          ctx.log(`Deleting "${row.title}" (${row.ratingKey}) — ${row.owner} is not a current user.`);
          await client.deleteItem(row.ratingKey);
          forgetCollections([row.ratingKey]);
        }
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
    synopsis: string | null,
    libraryItems: PlexItem[],
    sectionTitle: string,
    minItems: number,
    maxItems: number,
    prefs?: UserPreferences,
    feature: "because-you-watched" | "because-you-watched-preview" = "because-you-watched",
  ): Promise<{
    collection: AiCollection | null;
    skipped: string | null;
    usage: BywCallUsage | null;
    response: string | null;
  }> {
    // A row this person has already said isn't for them: don't spend a model call
    // rebuilding it. The name is fixed, so it can be checked before anything else.
    const rowName = bywRowName(watchedTitle);
    const excludedRows = new Set((prefs?.excludedCollections ?? []).map((t) => t.toLowerCase()));
    if (excludedRows.has(rowName.toLowerCase())) {
      ctx.log(`Skipping "${rowName}" — the user said it wasn't for them.`);
      return { collection: null, skipped: "the user said this row wasn't for them", usage: null, response: null };
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
    // Per-call, so it goes in `prompt`, never `library`.
    const synopsisBlock = bywSynopsisBlock(synopsis);

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
${synopsisBlock}
Rules:
- Name the collection "${rowName}"
- The collection MUST have between ${minItems} and ${maxItems} items
- Only use titles that exactly match the library list above
- Do NOT include "${watchedTitle}" in the collection
- Pick items that are thematically similar${synopsis ? " to what it's about" : ""}: shared vibes, tonal similarities, narrative parallels, genre connections, visual motifs
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
      return { collection: null, skipped: "the answer wasn't parseable JSON", usage, response: text };
    }

    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const result = aiCollectionSchema.safeParse(obj);
    if (!result.success) {
      ctx.log(`Skipping "${watchedTitle}" — invalid AI response: ${result.error.message}`);
      return {
        collection: null,
        skipped: `the answer had the wrong shape: ${result.error.message}`,
        usage,
        response: text,
      };
    }

    return { collection: result.data, skipped: null, usage, response: text };
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
   *
   * `onStep` narrates the run as it goes. A test against a whole library and a
   * slow or local model is minutes of silence otherwise, and when it dies part
   * way the last step is the only clue to which part — Plex, the library read
   * or a model call — was the slow one.
   */
  async function previewBecauseYouWatched(
    input: {
      sectionKey: string;
      plexUsername?: string;
      watchedTitle?: string;
      count?: number;
      /** Overrides the job's setting, so the two can be compared on the same title. */
      includeSynopsis?: boolean;
    },
    signal: AbortSignal,
    onStep: (message: string) => void = () => {},
  ): Promise<BywPreviewResult> {
    const { url: PLEX_URL, token: PLEX_TOKEN } = plexConnection(getConfig);
    const llmConfig = getLlmConfig();
    if (!PLEX_TOKEN) throw new Error("Plex token is required. Configure it in Settings.");
    if (!llmConfig) throw new Error("LLM provider is not configured. Set one above.");

    // The job's own settings, so the preview builds the row a run would.
    const jobConfig = (db.select({ config: jobs.config }).from(jobs).where(eq(jobs.id, "because-you-watched")).get()
      ?.config ?? {}) as BywJobConfig;
    const minItems = jobConfig.minItems ?? BYW_DEFAULTS.minItems;
    const maxItems = jobConfig.maxItems ?? BYW_DEFAULTS.maxItems;
    const includeSynopsis = input.includeSynopsis ?? jobConfig.includeSynopsis ?? BYW_DEFAULTS.includeSynopsis;

    const client = createPlexClient({ url: PLEX_URL, token: PLEX_TOKEN, signal, onHealth: plexHealthCallback });
    onStep(`Reading libraries from Plex…`);
    const sections = await client.getSections();
    const section = sections.find((s) => s.key === input.sectionKey);
    if (!section) throw new Error(`No library section with key ${input.sectionKey}.`);

    let user: ResolvedUser | undefined;
    if (input.plexUsername) {
      onStep(`Looking up ${input.plexUsername}'s Plex account…`);
      const wanted = input.plexUsername.toLowerCase();
      user = (await resolveUsers(client)).find(
        (u) => u.plexUsername.toLowerCase() === wanted || u.name.toLowerCase() === wanted,
      );
      if (!user) throw new Error(`"${input.plexUsername}" isn't on the Users page.`);
    }
    const prefs = user ? getOptedInPreferencesByUsername(user.plexUsername) : undefined;

    if (prefs) onStep(`Applying ${user!.name}'s preferences.`);

    const count = Math.min(Math.max(input.count ?? 1, 1), 3);
    let titles: Watched[];
    if (input.watchedTitle?.trim()) {
      // Its Plex item is looked up in the library below, once that is read.
      titles = [{ title: input.watchedTitle.trim(), ratingKey: undefined }];
    } else {
      onStep(`Reading ${user ? `${user.name}'s` : "the server's"} watch history in "${section.title}"…`);
      titles = await recentlyWatched(client, user?.accountID, section.key, count);
    }
    if (titles.length === 0) {
      throw new Error(`No watch history in "${section.title}"${user ? ` for ${user.name}` : ""} to build from.`);
    }
    onStep(`Building from: ${titles.map((w) => w.title).join(", ")}.`);

    onStep(`Reading every title in "${section.title}"…`);
    const libraryItems = await client.fetchAllItems(section.key);
    onStep(`${libraryItems.length} titles read — the whole list goes to the model as the library.`);
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
    for (const [i, watched] of titles.entries()) {
      const watchedTitle = watched.title;
      const rowName = bywRowName(watchedTitle);
      const base = { watchedTitle, rowName, existsAlready: existingNames.has(rowName.toLowerCase()), synopsis: null };
      try {
        let synopsis: string | null = null;
        if (includeSynopsis) {
          const wanted = watchedTitle.toLowerCase();
          const ratingKey =
            watched.ratingKey ??
            libraryItems.find(
              (item) =>
                item.title.toLowerCase() === wanted ||
                `${item.title}${item.year ? ` (${item.year})` : ""}`.toLowerCase() === wanted,
            )?.ratingKey;
          onStep(`[${i + 1}/${titles.length}] Reading the synopsis of "${watchedTitle}"…`);
          synopsis = await synopsisOf(client, ratingKey, onStep);
          if (!synopsis) {
            onStep(
              ratingKey
                ? `[${i + 1}/${titles.length}] Plex has no synopsis for it; asking without one.`
                : `[${i + 1}/${titles.length}] "${watchedTitle}" isn't in the library, so there's no synopsis to send.`,
            );
          }
        }
        onStep(
          `[${i + 1}/${titles.length}] Asking ${llmConfig.provider}:${llmConfig.model} for "${rowName}"${synopsis ? " with its synopsis" : ""}…`,
        );
        const { collection, skipped, usage, response } = await generateBYWCollection(
          llmConfig,
          { log, signal },
          watchedTitle,
          synopsis,
          libraryItems,
          section.title,
          minItems,
          maxItems,
          prefs,
          "because-you-watched-preview",
        );
        const items = (collection?.items ?? []).map((title) => ({ title, matched: known.has(title) }));
        const matchedCount = items.filter((item) => item.matched).length;
        onStep(
          usage
            ? `[${i + 1}/${titles.length}] Answered in ${(usage.durationMs / 1000).toFixed(1)}s — ${usage.tokensIn} tokens in, ${usage.tokensOut} out; ${matchedCount} of ${items.length} titles in the library.${skipped ? ` Unusable: ${skipped}.` : ""}`
            : `[${i + 1}/${titles.length}] Skipped: ${skipped}.`,
        );
        rows.push({
          ...base,
          synopsis,
          items,
          matchedCount,
          wouldCreate: matchedCount >= minItems,
          error: skipped,
          usage,
          response,
        });
      } catch (err) {
        // Stopped by the caller: no later call would run either, so end here
        // rather than record the same abort once per remaining title.
        if (signal.aborted) throw err;
        onStep(`[${i + 1}/${titles.length}] Failed: ${errorMessage(err)}`);
        rows.push({
          ...base,
          items: [],
          matchedCount: 0,
          wouldCreate: false,
          error: errorMessage(err),
          usage: null,
          response: null,
        });
      }
    }

    return {
      sectionTitle: section.title,
      user: user?.name ?? null,
      libraryTitles: libraryItems.length,
      minItems,
      includeSynopsis,
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

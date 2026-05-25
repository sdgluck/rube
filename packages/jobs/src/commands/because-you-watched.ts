import { createLlmClient, type LlmConfig } from "@tinkerbell/llm";
import { errorMessage } from "@tinkerbell/core";
import { createPlexClient, type PlexItem } from "@tinkerbell/plex";
import { plexHealthCallback } from "@tinkerbell/core";
import { getConfig, getLlmConfig } from "@tinkerbell/core";
import { getOptedInPreferencesByUsername, preferencesPromptBlock, type UserPreferences } from "@tinkerbell/core";
import { reportHealth } from "@tinkerbell/domain.health";
import { upsertCollectionByKey } from "@tinkerbell/domain.collections";
import { z } from "zod";
import type { JobContext, BywJobConfig } from "@tinkerbell/core";

const BYW_LABEL = "BecauseYouWatched";
const BYW_LABELS = ["Tinkerbell", BYW_LABEL];

const aiCollectionSchema = z.object({
  name: z.string(),
  items: z.array(z.string()),
});

type AiCollection = z.infer<typeof aiCollectionSchema>;

export default async function run(ctx: JobContext, config: BywJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  const llmConfig = getLlmConfig();
  const LIMIT = config.limit ?? 10;
  const MODE = config.mode ?? "per-user";
  const PIN_TO_HOMEPAGE = config.pinToHomepage ?? true;
  const MIN_ITEMS = config.minItems ?? 10;
  const MAX_ITEMS = config.maxItems ?? 30;
  const MIN_LIBRARY_SIZE = config.minLibrarySize ?? 15;
  const userAllowlist = (config.users ?? []).map((u) => u.toLowerCase());

  if (!PLEX_TOKEN) {
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  if (!llmConfig) {
    throw new Error("LLM provider is not configured. Set one in Settings → AI.");
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

  type ResolvedUser = { name: string; plexUsername: string; accountID: string | undefined };
  let resolvedUsers: ResolvedUser[] = [];

  if (MODE === "server") {
    resolvedUsers = [{ name: "", plexUsername: "", accountID: undefined }];
  } else {
    const accounts = await client.getAccounts();
    const sharings = await client.getSharings(machineId);
    const idToPlexUsername = new Map<string, string>();
    for (const s of sharings) {
      idToPlexUsername.set(String(s.userId), s.username);
    }

    for (const account of accounts) {
      if (account.name) {
        const plexUsername = idToPlexUsername.get(account.id) || account.name;
        resolvedUsers.push({ name: account.name, plexUsername, accountID: account.id });
      }
    }
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
      const history = await client.getWatchHistory({
        accountID: user.accountID,
        librarySectionID: sectionId,
        limit: LIMIT * 5,
      });

      if (history.length === 0) {
        ctx.log(`No watch history found, skipping.`);
        continue;
      }

      // Deduplicate
      const seen = new Set<string>();
      const watchedItems = [];
      for (const item of history) {
        const key =
          item.type === "episode"
            ? `show:${item.grandparentRatingKey || item.grandparentTitle}`
            : `${item.type}:${item.ratingKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        watchedItems.push(item);
        if (watchedItems.length >= LIMIT) break;
      }

      ctx.log(`Found ${watchedItems.length} unique recently watched item(s).`);

      // Fetch all items in section
      ctx.log(`Fetching library items...`);
      const libraryItems = await client.fetchAllItems(sectionId);
      ctx.log(`Found ${libraryItems.length} item(s).`);

      if (libraryItems.length < MIN_LIBRARY_SIZE) {
        ctx.log(`Too few items (${libraryItems.length} < ${MIN_LIBRARY_SIZE}) to generate collections, skipping.`);
        continue;
      }

      const watchedTitles = watchedItems.map((item) =>
        item.type === "episode" ? item.grandparentTitle! : `${item.title}${item.year ? ` (${item.year})` : ""}`,
      );

      ctx.log(`Asking the LLM for "Because you watched" collections...`);
      const aiCollections: AiCollection[] = [];
      for (let i = 0; i < watchedTitles.length; i++) {
        const title = watchedTitles[i];
        ctx.log(`[${i + 1}/${watchedTitles.length}] Generating collection for "${title}"...`);
        try {
          const col = await generateBYWCollection(
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
      const allCollections = await client.getCollections(sectionId);
      let deleted = 0;
      for (const col of allCollections) {
        const labels = await client.getCollectionLabels(col.ratingKey);
        const hasByw = labels.some((l) => l.tag.toLowerCase() === BYW_LABEL.toLowerCase());
        if (!hasByw) continue;

        if (isPerUser) {
          const hasUserLabel = labels.some((l) => l.tag === `User:${user.plexUsername}`);
          if (!hasUserLabel) continue;
        }

        if (newCollectionNames.has(col.title.toLowerCase())) {
          ctx.log(`Keeping "${col.title}" (still relevant)`);
          continue;
        }
        ctx.log(`Deleting collection "${col.title}" (${col.ratingKey})`);
        await client.deleteItem(col.ratingKey);
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

        const existingCol = allCollections.find((c) => c.title.toLowerCase() === col.name.toLowerCase());
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

async function generateBYWCollection(
  llmConfig: LlmConfig,
  ctx: JobContext,
  watchedTitle: string,
  libraryItems: PlexItem[],
  sectionTitle: string,
  minItems: number,
  maxItems: number,
  prefs?: UserPreferences,
): Promise<AiCollection | null> {
  // Hard-exclude any titles the user never wants recommended before the
  // candidate list even reaches the model.
  const excluded = new Set((prefs?.excludedTitles ?? []).map((t) => t.toLowerCase()));
  const candidates =
    excluded.size > 0
      ? libraryItems.filter((i) => !excluded.has(i.title.toLowerCase()) && !excluded.has(watchedTitle.toLowerCase()))
      : libraryItems;
  const itemList = candidates.map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`).join("\n");
  const prefsBlock = prefs ? preferencesPromptBlock(prefs) : "";

  const prompt = `You are a movie/TV curator. Given a recently watched item and a full Plex "${sectionTitle}" library, create a "Because you watched" collection.

Recently watched: ${watchedTitle}

Rules:
- Name the collection "Because you watched ${watchedTitle}"
- The collection MUST have between ${minItems} and ${maxItems} items
- Only use titles that exactly match the library list below
- Do NOT include "${watchedTitle}" in the collection
- Pick items that are thematically similar: shared vibes, tonal similarities, narrative parallels, genre connections, visual motifs
- The collection should feel like a genuine recommendation, not just the same genre
${prefsBlock}
Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
{"name":"Because you watched ${watchedTitle}","items":["Title (Year)","Title (Year)"]}

Here is the full library:
${itemList}`;

  const client = createLlmClient(llmConfig);
  let text: string;
  try {
    const res = await client.complete({ prompt, maxTokens: 1024, signal: ctx.signal });
    reportHealth("LLM", "ok", `${res.provider}:${res.model} — ${res.tokensIn} in, ${res.tokensOut} out`);
    text = res.text;
  } catch (err) {
    reportHealth("LLM", "error", errorMessage(err));
    throw err;
  }

  ctx.log("AI response:", text);

  const parsed = extractJSON(text);
  if (parsed === null) {
    ctx.log(`Skipping "${watchedTitle}" — could not extract JSON from AI response`);
    return null;
  }

  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  const result = aiCollectionSchema.safeParse(obj);
  if (!result.success) {
    ctx.log(`Skipping "${watchedTitle}" — invalid AI response: ${result.error.message}`);
    return null;
  }

  return result.data;
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

import { createPlexClient, type PlexHub, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";
import type { JobContext, CommonJobConfig } from "../shared/job-context.ts";

const COLLECTION_HUB_PREFIX = "custom.collection.";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseCollectionRatingKey(hubIdentifier: string): string | null {
  if (!hubIdentifier.startsWith(COLLECTION_HUB_PREFIX)) return null;
  const rest = hubIdentifier.slice(COLLECTION_HUB_PREFIX.length);
  // Format: {sectionId}.{ratingKey}
  const dot = rest.indexOf(".");
  if (dot < 0) return null;
  return rest.slice(dot + 1);
}

export default async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

  if (!PLEX_TOKEN) {
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: ctx.signal,
  });

  async function shuffleSection(section: PlexSection): Promise<void> {
    const sectionId = section.key;
    const sectionTitle = section.title;

    const hubs = await client.getManagedHubs(sectionId);

    const collectionHubs = hubs.filter((h) => h.identifier.startsWith(COLLECTION_HUB_PREFIX));

    if (collectionHubs.length < 2) {
      ctx.log(`"${sectionTitle}" — only ${collectionHubs.length} collection hub(s), nothing to shuffle.`);
      return;
    }

    const shuffled = shuffleArray(collectionHubs);

    ctx.log(`"${sectionTitle}" — unpinning ${collectionHubs.length} collection hubs...`);
    for (const hub of collectionHubs) {
      await client.unpinFromHomepage(sectionId, hub.identifier);
    }

    ctx.log(`"${sectionTitle}" — re-pinning in shuffled order...`);
    for (const hub of shuffled) {
      const ratingKey = parseCollectionRatingKey(hub.identifier);
      if (!ratingKey) {
        ctx.log(`  skipping "${hub.title}" — could not parse ratingKey from ${hub.identifier}`);
        continue;
      }
      await client.pinToHomepage(sectionId, ratingKey, {
        promotedToOwnHome: hub.promotedToOwnHome ?? 0,
        promotedToRecommendedHome: hub.promotedToRecommendedHome ?? 0,
        promotedToSharedHome: hub.promotedToSharedHome ?? 0,
      });
    }

    ctx.log(`"${sectionTitle}" — ${shuffled.length} hubs shuffled.`);
  }

  ctx.log(`tinkerbell shuffle`);
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  let sections;
  if (config.sections && config.sections.length > 0) {
    const names = config.sections.map((s) => s.trim().toLowerCase());
    sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (sections.length === 0) {
      throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
    }
  } else {
    sections = allSections;
  }

  ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

  for (const section of sections) {
    ctx.progress(sections.indexOf(section) + 1, sections.length, `Shuffling "${section.title}"...`);
    await shuffleSection(section);
  }

  ctx.log("All done!");
}

import { createPlexClient, type PlexHub, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";
import type { JobContext, CommonJobConfig } from "../job-context.ts";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

  const MAX_REORDER_ATTEMPTS = 8;
  const SETTLE_DELAY = 3000;

  function isCustomHub(hub: PlexHub): boolean {
    return hub.identifier.startsWith("custom.");
  }

  async function reorderCustomHubs(sectionId: string, allHubs: PlexHub[], customOrder: PlexHub[]): Promise<void> {
    for (let attempt = 1; attempt <= MAX_REORDER_ATTEMPTS; attempt++) {
      if (attempt === 1) {
        for (let i = 0; i < allHubs.length; i++) {
          if (!isCustomHub(allHubs[i])) continue;
          const afterId = i === 0 ? "" : allHubs[i - 1].identifier;
          ctx.log(`Moving "${allHubs[i].title}" → after "${i === 0 ? "(beginning)" : allHubs[i - 1].title}"`);
          await client.moveHub(sectionId, allHubs[i].identifier, afterId);
        }
      } else {
        const current = await client.getManagedHubs(sectionId);
        let fixes = 0;
        for (let i = 0; i < allHubs.length; i++) {
          if (!isCustomHub(allHubs[i])) continue;
          if (current[i]?.identifier !== allHubs[i].identifier) {
            const afterId = i === 0 ? "" : allHubs[i - 1].identifier;
            ctx.log(`Fixing "${allHubs[i].title}" at position ${i}`);
            await client.moveHub(sectionId, allHubs[i].identifier, afterId);
            fixes++;
          }
        }
        if (fixes === 0) {
          ctx.log(`Settled after ${attempt} attempt(s)`);
          return;
        }
      }

      await new Promise((r) => setTimeout(r, SETTLE_DELAY));

      const actual = await client.getManagedHubs(sectionId);
      let mismatches = 0;
      for (let i = 0; i < allHubs.length; i++) {
        if (actual[i]?.identifier !== allHubs[i].identifier) mismatches++;
      }

      if (mismatches === 0) {
        if (attempt > 1) ctx.log(`Settled after ${attempt} attempt(s)`);
        return;
      }

      ctx.log(`Attempt ${attempt}: ${mismatches}/${allHubs.length} hubs misplaced, retrying...`);
    }

    ctx.log(`Warning: could not fully settle after ${MAX_REORDER_ATTEMPTS} attempts`);
  }

  async function shuffleSection(section: PlexSection): Promise<void> {
    const sectionId = section.key;
    const sectionTitle = section.title;

    const hubs = await client.getManagedHubs(sectionId);

    if (hubs.length < 2) {
      ctx.log(`"${sectionTitle}" — only ${hubs.length} hub(s), nothing to shuffle.`);
      return;
    }

    ctx.log(`"${sectionTitle}" — shuffling ${hubs.length} hubs...`);

    const systemHubs = hubs.filter((h) => !isCustomHub(h));
    const customHubs = hubs.filter((h) => isCustomHub(h));

    if (customHubs.length < 2) {
      ctx.log(`"${sectionTitle}" — only ${customHubs.length} custom hub(s), nothing to shuffle.`);
      return;
    }

    const PINNED_TITLES: Record<string, string[]> = {
      Films: ["Recently Added Movies", "Recently Released Movies"],
      TV: ["Recently Added TV"],
    };
    const pinnedTitles = PINNED_TITLES[sectionTitle] || [];
    const pinnedCustom = pinnedTitles.map((t) => customHubs.find((h) => h.title === t)).filter(Boolean) as PlexHub[];
    const shuffleable = customHubs.filter((h) => !pinnedCustom.includes(h));
    const shuffledCustom = [...pinnedCustom, ...shuffleArray(shuffleable)];

    const finalOrder: PlexHub[] = [];
    let customIdx = 0;
    for (const hub of hubs) {
      if (isCustomHub(hub)) {
        finalOrder.push(shuffledCustom[customIdx++]);
      } else {
        finalOrder.push(hub);
      }
    }

    await reorderCustomHubs(sectionId, finalOrder, shuffledCustom);

    ctx.log(`"${sectionTitle}" — ${hubs.length} hubs shuffled.`);
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

import { createPlexClient, type PlexHub, type PlexSection } from "../plex.ts";
import { getConfig } from "../config.ts";

interface ShuffleArgs {
  url?: string;
  token?: string;
  sections?: string;
  "dry-run"?: boolean;
  verbose?: boolean;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function run(args: ShuffleArgs): Promise<void> {
  const PLEX_URL = (
    args.url ||
    getConfig("global_plex_url") ||
    process.env.PLEX_URL ||
    "http://localhost:32400"
  ).replace(/\/+$/, "");
  const PLEX_TOKEN = args.token || getConfig("global_plex_token") || process.env.PLEX_TOKEN;
  const DRY_RUN = args["dry-run"];
  const VERBOSE = args.verbose;

  if (!PLEX_TOKEN) {
    console.error("Error: Plex token is required. Use --token or set PLEX_TOKEN.");
    process.exit(1);
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    verbose: VERBOSE,
  });

  const MAX_REORDER_ATTEMPTS = 8;
  const SETTLE_DELAY = 3000;

  function isCustomHub(hub: PlexHub): boolean {
    return hub.identifier.startsWith("custom.");
  }

  async function reorderCustomHubs(sectionId: string, allHubs: PlexHub[], customOrder: PlexHub[]): Promise<void> {
    if (DRY_RUN) return;

    // Only move custom collection hubs — built-in Plex hubs (movie.genre,
    // movie.recentlyadded, etc.) have fixed positions and cannot be moved
    // via the API. We place each custom hub after the hub that should
    // precede it in the final order (which may be a system hub).
    for (let attempt = 1; attempt <= MAX_REORDER_ATTEMPTS; attempt++) {
      if (attempt === 1) {
        for (let i = 0; i < allHubs.length; i++) {
          if (!isCustomHub(allHubs[i])) continue;
          const afterId = i === 0 ? "" : allHubs[i - 1].identifier;
          client.log(`Moving "${allHubs[i].title}" → after "${i === 0 ? "(beginning)" : allHubs[i - 1].title}"`);
          await client.moveHub(sectionId, allHubs[i].identifier, afterId);
        }
      } else {
        const current = await client.getManagedHubs(sectionId);
        let fixes = 0;
        for (let i = 0; i < allHubs.length; i++) {
          if (!isCustomHub(allHubs[i])) continue;
          if (current[i]?.identifier !== allHubs[i].identifier) {
            const afterId = i === 0 ? "" : allHubs[i - 1].identifier;
            client.log(`Fixing "${allHubs[i].title}" at position ${i}`);
            await client.moveHub(sectionId, allHubs[i].identifier, afterId);
            fixes++;
          }
        }
        if (fixes === 0) {
          client.log(`Settled after ${attempt} attempt(s)`);
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
        if (attempt > 1) client.log(`Settled after ${attempt} attempt(s)`);
        return;
      }

      client.log(`Attempt ${attempt}: ${mismatches}/${allHubs.length} hubs misplaced, retrying...`);
    }

    client.log(`Warning: could not fully settle after ${MAX_REORDER_ATTEMPTS} attempts`);
  }

  async function shuffleSection(section: PlexSection): Promise<void> {
    const sectionId = section.key;
    const sectionTitle = section.title;

    const hubs = await client.getManagedHubs(sectionId);

    if (hubs.length < 2) {
      console.log(`⏭  "${sectionTitle}" — only ${hubs.length} hub(s), nothing to shuffle.`);
      return;
    }

    console.log(`\n🔀 "${sectionTitle}" — shuffling ${hubs.length} hubs...`);

    if (VERBOSE) {
      console.log("   Current order:");
      hubs.forEach((h, i) => console.log(`    ${String(i + 1).padStart(2)}. ${h.title} [${h.identifier}]`));
    }

    // Built-in Plex hubs (movie.genre, etc.) cannot be moved via the API,
    // so we keep them in their original positions and only shuffle custom
    // collection hubs into the remaining slots.
    const systemHubs = hubs.filter((h) => !isCustomHub(h));
    const customHubs = hubs.filter((h) => isCustomHub(h));

    if (customHubs.length < 2) {
      console.log(`⏭  "${sectionTitle}" — only ${customHubs.length} custom hub(s), nothing to shuffle.`);
      return;
    }

    // Keep pinned custom hubs at the top of the custom section
    const PINNED_TITLES: Record<string, string[]> = {
      Films: ["Recently Added Movies", "Recently Released Movies"],
      TV: ["Recently Added TV"],
    };
    const pinnedTitles = PINNED_TITLES[sectionTitle] || [];
    const pinnedCustom = pinnedTitles.map((t) => customHubs.find((h) => h.title === t)).filter(Boolean) as PlexHub[];
    const shuffleable = customHubs.filter((h) => !pinnedCustom.includes(h));
    const shuffledCustom = [...pinnedCustom, ...shuffleArray(shuffleable)];

    // Rebuild full hub list: system hubs stay in their original positions,
    // custom hubs fill the remaining slots in shuffled order.
    const finalOrder: PlexHub[] = [];
    let customIdx = 0;
    for (const hub of hubs) {
      if (isCustomHub(hub)) {
        finalOrder.push(shuffledCustom[customIdx++]);
      } else {
        finalOrder.push(hub);
      }
    }

    if (VERBOSE) {
      console.log("   New order:");
      finalOrder.forEach((h, i) => console.log(`    ${String(i + 1).padStart(2)}. ${h.title} [${h.identifier}]`));
    }

    await reorderCustomHubs(sectionId, finalOrder, shuffledCustom);

    console.log(`✅ "${sectionTitle}" — ${hubs.length} hubs shuffled${DRY_RUN ? " (dry run)" : ""}.`);
  }

  console.log(`🎲 tinkerbell shuffle${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`   Server: ${PLEX_URL}`);

  try {
    const identity = await client.getIdentity();
    console.log(`   Server name: ${identity.friendlyName}`);
  } catch (err) {
    console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
    console.error(`   ${(err as Error).message}`);
    process.exit(1);
  }

  let allSections = await client.getSections();

  const configuredLibraries = getConfig("global_plex_libraries");
  if (configuredLibraries) {
    allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
  }

  let sections;
  if (args.sections) {
    const names = args.sections.split(",").map((s) => s.trim().toLowerCase());
    sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
    if (sections.length === 0) {
      console.error(`\n❌ No matching sections found for "${args.sections}".`);
      console.error("   Available sections:");
      allSections.forEach((s) => console.error(`     [${s.key}] ${s.title} (${s.type})`));
      process.exit(1);
    }
  } else {
    sections = allSections;
  }

  console.log(`   Sections: ${sections.map((s) => s.title).join(", ")}`);

  for (const section of sections) {
    await shuffleSection(section);
  }

  console.log("\n🎉 All done!");
}

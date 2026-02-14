import { createPlexClient } from "../plex.mjs";

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function run(args) {
  const PLEX_URL = (
    args.url ||
    process.env.PLEX_URL ||
    "http://localhost:32400"
  ).replace(/\/+$/, "");
  const PLEX_TOKEN = args.token || process.env.PLEX_TOKEN;
  const DRY_RUN = args["dry-run"];
  const VERBOSE = args.verbose;

  if (!PLEX_TOKEN) {
    console.error(
      "Error: Plex token is required. Use --token or set PLEX_TOKEN.",
    );
    process.exit(1);
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    verbose: VERBOSE,
  });

  async function reorderHubs(sectionId, orderedHubs) {
    for (let i = 0; i < orderedHubs.length; i++) {
      const hub = orderedHubs[i];
      const afterIdentifier = i === 0 ? "" : orderedHubs[i - 1].identifier;

      client.log(
        `Moving "${hub.title}" (${hub.identifier}) → after "${afterIdentifier || "(beginning)"}"`,
      );

      if (!DRY_RUN) {
        await client.moveHub(sectionId, hub.identifier, afterIdentifier);
      }
    }
  }

  async function shuffleSection(section) {
    const sectionId = section.key;
    const sectionTitle = section.title;

    const hubs = await client.getManagedHubs(sectionId);

    if (hubs.length < 2) {
      console.log(
        `⏭  "${sectionTitle}" — only ${hubs.length} hub(s), nothing to shuffle.`,
      );
      return;
    }

    console.log(`\n🔀 "${sectionTitle}" — shuffling ${hubs.length} hubs...`);

    if (VERBOSE) {
      console.log("   Current order:");
      hubs.forEach((h, i) =>
        console.log(
          `    ${String(i + 1).padStart(2)}. ${h.title} [${h.identifier}]`,
        ),
      );
    }

    // Keep pinned hubs at the top per section
    const PINNED_TITLES = {
      Films: ["Recently Added Movies", "Recently Released Movies"],
      TV: ["Recently Added TV"],
    };
    const pinnedTitles = PINNED_TITLES[sectionTitle] || [];
    const pinned = pinnedTitles
      .map((t) => hubs.find((h) => h.title === t))
      .filter(Boolean);
    const rest = hubs.filter((h) => !pinned.includes(h));
    const shuffled = [...pinned, ...shuffleArray(rest)];

    if (VERBOSE) {
      console.log("   New order:");
      shuffled.forEach((h, i) =>
        console.log(
          `    ${String(i + 1).padStart(2)}. ${h.title} [${h.identifier}]`,
        ),
      );
    }

    await reorderHubs(sectionId, shuffled);

    console.log(
      `✅ "${sectionTitle}" — ${hubs.length} hubs shuffled${DRY_RUN ? " (dry run)" : ""}.`,
    );
  }

  console.log(`🎲 tinkerbell shuffle${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log(`   Server: ${PLEX_URL}`);

  try {
    const identity = await client.getIdentity();
    console.log(`   Server name: ${identity.friendlyName}`);
  } catch (err) {
    console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }

  const allSections = await client.getSections();

  let sections;
  if (args.section) {
    const match = allSections.find(
      (s) =>
        s.key === args.section ||
        s.title.toLowerCase() === args.section.toLowerCase(),
    );
    if (!match) {
      console.error(`\n❌ Section "${args.section}" not found.`);
      console.error("   Available sections:");
      allSections.forEach((s) =>
        console.error(`     [${s.key}] ${s.title} (${s.type})`),
      );
      process.exit(1);
    }
    sections = [match];
  } else {
    sections = allSections;
  }

  console.log(`   Sections: ${sections.map((s) => s.title).join(", ")}`);

  for (const section of sections) {
    await shuffleSection(section);
  }

  console.log("\n🎉 All done!");
}

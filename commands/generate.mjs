import Anthropic from "@anthropic-ai/sdk";
import { createPlexClient } from "../plex.mjs";

export default async function run(args) {
  const PLEX_URL = (
    args.url ||
    process.env.PLEX_URL ||
    "http://localhost:32400"
  ).replace(/\/+$/, "");
  const PLEX_TOKEN = args.token || process.env.PLEX_TOKEN;
  const MAX_COLLECTIONS = parseInt(args.limit, 10) || 8;
  if (MAX_COLLECTIONS > 10) {
    console.error("Error: --limit cannot exceed 10.");
    process.exit(1);
  }
  const VERBOSE = args.verbose;

  if (!PLEX_TOKEN) {
    console.error(
      "Error: Plex token is required. Use --token or set PLEX_TOKEN.",
    );
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    process.exit(1);
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    verbose: VERBOSE,
  });

  async function generateCollections(items, sectionTitle, maxCollections) {
    const anthropic = new Anthropic();

    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const itemList = shuffled
      .map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`)
      .join("\n");

    const seed = Math.floor(Math.random() * 1_000_000);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      temperature: 1,
      messages: [
        {
          role: "user",
          content: `You are a movie/TV curator. Given this list of items from a Plex "${sectionTitle}" library, create curated themed collections.

Rules:
- Create exactly ${maxCollections} collections
- Each collection MUST have between 15 and 30 items, no fewer than 15
- Each item can appear in multiple collections
- Only use titles that exactly match the input list
- Collection names should be creative, fun, relatively short, not academic, and NEVER use colons (no "Title: Subtitle" format)
- Be surprising and inventive with your themes — avoid obvious genres or decades groupings
- Think of unexpected connections between items: tonal similarities, visual motifs, narrative parallels, thematic undercurrents, shared vibes

Random seed for variety: ${seed}

Return ONLY valid minified JSON on a single line, no markdown fences, no explanation, no newlines within the JSON. Format:
[{"name":"Collection Name","items":["Title (Year)","Title (Year)"]}]

Here are the items:
${itemList}`,
        },
      ],
    });

    const text = response.content[0].text.trim();
    client.log("AI response:", text);
    return parseJSON(text);
  }

  function parseJSON(text) {
    // Try parsing as-is
    try {
      return JSON.parse(text);
    } catch {}

    // Extract JSON array from markdown fences or surrounding text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}

      // Fix trailing commas and retry
      const cleaned = match[0]
        .replace(/,\s*([}\]])/g, "$1") // trailing commas
        .replace(/[\x00-\x1f]/g, " "); // control chars
      try {
        return JSON.parse(cleaned);
      } catch {}
    }

    throw new Error(`Failed to parse AI response as JSON:\n${text}`);
  }

  async function processSection(section, machineId) {
    const sectionId = section.key;
    const sectionTitle = section.title;

    console.log(`\n📚 "${sectionTitle}" — starting...`);

    // Step 1: Delete old tinkerbell collections
    console.log(`   🗑  Deleting previous tinkerbell collections...`);
    const deleted = await client.deleteTinkerbellCollections(sectionId);
    console.log(`   🗑  Deleted ${deleted} old collection(s).`);

    // Step 2: Fetch all items
    console.log(`   📥 Fetching library items...`);
    const items = await client.fetchAllItems(sectionId);
    console.log(`   📥 Found ${items.length} item(s).`);

    if (items.length < 10) {
      console.log(`   ⏭  Too few items to generate collections, skipping.`);
      return;
    }

    // Step 3: Ask AI for collections
    console.log(`   🤖 Asking Claude for curated collections...`);
    const aiCollections = await generateCollections(
      items,
      sectionTitle,
      MAX_COLLECTIONS,
    );
    console.log(`   🤖 Got ${aiCollections.length} collection(s) from AI.`);

    // Build title→ratingKey lookup
    const titleMap = new Map();
    for (const item of items) {
      const key = `${item.title}${item.year ? ` (${item.year})` : ""}`;
      titleMap.set(key, item.ratingKey);
      // Also map without year for fuzzy matching
      titleMap.set(item.title, item.ratingKey);
    }

    // Step 4: Create collections and pin them
    let created = 0;
    for (const col of aiCollections) {
      const ratingKeys = col.items
        .map((title) => titleMap.get(title))
        .filter(Boolean);

      if (ratingKeys.length < 15) {
        client.log(
          `Skipping "${col.name}" — only ${ratingKeys.length} matching item(s), need at least 15`,
        );
        continue;
      }

      console.log(
        `   📦 Creating "${col.name}" (${ratingKeys.length} items)...`,
      );

      const collectionKey = await client.createCollection(
        sectionId,
        section.type,
        machineId,
        col.name,
        ratingKeys,
      );

      if (collectionKey) {
        const pinned = await client.pinToHomepage(sectionId, collectionKey);
        if (pinned) {
          client.log(`Pinned "${col.name}" to homepage`);
        } else {
          client.log(`Created "${col.name}" but could not pin to homepage`);
        }
        created++;
      }
    }

    console.log(
      `   ✅ Created and pinned ${created} collection(s) for "${sectionTitle}".`,
    );
  }

  console.log(`🧚 tinkerbell generate`);
  console.log(`   Server: ${PLEX_URL}`);

  let machineId;
  try {
    const identity = await client.getIdentity();
    machineId = identity.machineIdentifier;
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
    await processSection(section, machineId);
  }

  console.log("\n🎉 All done!");
}

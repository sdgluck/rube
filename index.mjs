#!/usr/bin/env node

/**
 * tinkerbell — Manage your Plex homepage hubs.
 *
 * Usage:
 *   tinkerbell <command> [options]
 *
 * Commands:
 *   shuffle            Shuffle the hub ordering on your Plex homepage
 *   generate           Use AI to create curated collections from library items
 *   cleanup            Delete tinkerbell-generated collections
 *
 * Global options:
 *   --url, -u          Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
 *   --token, -t        Plex auth token           (env: PLEX_TOKEN)
 *   --verbose, -v      Show detailed output      (default: false)
 *   --help, -h         Show this help message
 *
 * Environment variables:
 *   PLEX_URL           Base URL of your Plex server
 *   PLEX_TOKEN         Your Plex authentication token
 */

import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";

// ─── CLI argument parsing ──────────────────────────────────────────────────────

const { values: globalArgs, positionals } = parseArgs({
    options: {
        url:     { type: "string",  short: "u" },
        token:   { type: "string",  short: "t" },
        verbose: { type: "boolean", short: "v", default: false },
        help:    { type: "boolean", short: "h", default: false },
    },
    strict: false,
    allowPositionals: true,
});

const command = positionals[0];

function printUsage() {
    console.log(`
tinkerbell — Manage your Plex homepage hubs.

Usage:
  tinkerbell <command> [options]

Commands:
  shuffle            Shuffle the hub ordering on your Plex homepage
  generate           Use AI to create curated collections from library items
  cleanup            Delete tinkerbell-generated collections

Global options:
  --url, -u          Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t        Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v      Show detailed output      (default: false)
  --help, -h         Show this help message

Run "tinkerbell <command> --help" for command-specific help.
    `.trim());
}

function printShuffleUsage() {
    console.log(`
tinkerbell shuffle — Shuffle the hub ordering on your Plex homepage.

Usage:
  tinkerbell shuffle [options]

Options:
  --section, -s    Library section name/ID   (omit to shuffle ALL sections)
  --dry-run, -d    Preview without applying  (default: false)

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Examples:
  PLEX_TOKEN=abc123 tinkerbell shuffle
  tinkerbell shuffle --url http://192.168.1.10:32400 --token abc123
  tinkerbell shuffle --token abc123 --section Movies --dry-run
    `.trim());
}

if (globalArgs.help && !command) {
    printUsage();
    process.exit(0);
}

if (!command) {
    printUsage();
    process.exit(1);
}

// ─── Sub-command: shuffle ───────────────────────────────────────────────────────

if (command === "shuffle") {
    // Re-parse with shuffle-specific options
    const { values: args } = parseArgs({
        options: {
            url:        { type: "string",  short: "u" },
            token:      { type: "string",  short: "t" },
            section:    { type: "string",  short: "s" },
            "dry-run":  { type: "boolean", short: "d", default: false },
            verbose:    { type: "boolean", short: "v", default: false },
            help:       { type: "boolean", short: "h", default: false },
        },
        strict: true,
        allowPositionals: true,
    });

    if (args.help) {
        printShuffleUsage();
        process.exit(0);
    }

    const PLEX_URL   = (args.url   || process.env.PLEX_URL || "http://localhost:32400").replace(/\/+$/, "");
    const PLEX_TOKEN = args.token  || process.env.PLEX_TOKEN;
    const DRY_RUN    = args["dry-run"];
    const VERBOSE    = args.verbose;

    if (!PLEX_TOKEN) {
        console.error("Error: Plex token is required. Use --token or set PLEX_TOKEN.");
        process.exit(1);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    const log = (...a) => VERBOSE && console.log("  ", ...a);

    async function plex(path, { method = "GET", params = {} } = {}) {
        const url = new URL(path, PLEX_URL);
        url.searchParams.set("X-Plex-Token", PLEX_TOKEN);
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        }

        log(`${method} ${url.pathname}${url.search.replace(PLEX_TOKEN, "***")}`);

        const res = await fetch(url.toString(), {
            method,
            headers: {
                Accept: "application/json",
                "X-Plex-Client-Identifier": "plex-hub-shuffle",
                "X-Plex-Product": "plex-hub-shuffle",
                "X-Plex-Version": "1.0.0",
            },
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
        }

        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ─── Core logic ─────────────────────────────────────────────────────────────

    async function getSections() {
        const data = await plex("/library/sections");
        return data.MediaContainer.Directory || [];
    }

    async function getManagedHubs(sectionId) {
        const data = await plex(`/hubs/sections/${sectionId}/manage`);
        return (data && data.MediaContainer && data.MediaContainer.Hub) || [];
    }

    async function moveHub(sectionId, hubId, afterId) {
        await plex(`/hubs/sections/${sectionId}/manage/${hubId}/move`, {
            method: "PUT",
            params: { after: afterId },
        });
    }

    async function reorderHubs(sectionId, orderedHubs) {
        for (let i = 0; i < orderedHubs.length; i++) {
            const hub = orderedHubs[i];
            const afterIdentifier = i === 0 ? "" : orderedHubs[i - 1].identifier;

            log(`Moving "${hub.title}" (${hub.identifier}) → after "${afterIdentifier || "(beginning)"}"`);

            if (!DRY_RUN) {
                await moveHub(sectionId, hub.identifier, afterIdentifier);
            }
        }
    }

    async function shuffleSection(section) {
        const sectionId = section.key;
        const sectionTitle = section.title;

        const hubs = await getManagedHubs(sectionId);

        if (hubs.length < 2) {
            console.log(`⏭  "${sectionTitle}" — only ${hubs.length} hub(s), nothing to shuffle.`);
            return;
        }

        console.log(`\n🔀 "${sectionTitle}" — shuffling ${hubs.length} hubs...`);

        if (VERBOSE) {
            console.log("   Current order:");
            hubs.forEach((h, i) => console.log(`    ${String(i + 1).padStart(2)}. ${h.title} [${h.identifier}]`));
        }

        const shuffled = shuffleArray(hubs);

        if (VERBOSE) {
            console.log("   New order:");
            shuffled.forEach((h, i) => console.log(`    ${String(i + 1).padStart(2)}. ${h.title} [${h.identifier}]`));
        }

        await reorderHubs(sectionId, shuffled);

        console.log(`✅ "${sectionTitle}" — ${hubs.length} hubs shuffled${DRY_RUN ? " (dry run)" : ""}.`);
    }

    // ─── Main ───────────────────────────────────────────────────────────────────

    async function main() {
        console.log(`🎲 tinkerbell shuffle${DRY_RUN ? " (DRY RUN)" : ""}`);
        console.log(`   Server: ${PLEX_URL}`);

        try {
            const identity = await plex("/");
            console.log(`   Server name: ${identity.MediaContainer.friendlyName}`);
        } catch (err) {
            console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
            console.error(`   ${err.message}`);
            process.exit(1);
        }

        const allSections = await getSections();

        let sections;
        if (args.section) {
            const match = allSections.find(
                (s) =>
                    s.key === args.section ||
                    s.title.toLowerCase() === args.section.toLowerCase()
            );
            if (!match) {
                console.error(`\n❌ Section "${args.section}" not found.`);
                console.error("   Available sections:");
                allSections.forEach((s) => console.error(`     [${s.key}] ${s.title} (${s.type})`));
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

    main().catch((err) => {
        console.error(`\n❌ Fatal error: ${err.message}`);
        if (VERBOSE) console.error(err.stack);
        process.exit(1);
    });
}

// ─── Sub-command: generate ──────────────────────────────────────────────────────

else if (command === "generate") {
    function printGenerateUsage() {
        console.log(`
tinkerbell generate — Use AI to create curated Plex collections.

Generates themed collections from your library items using Claude AI,
pins them to your homepage, and cleans up previously generated ones.

Usage:
  tinkerbell generate [options]

Options:
  --section, -s    Library section name/ID   (omit to generate for ALL sections)
  --limit, -l      Max collections per section (default: 8)

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Environment variables:
  ANTHROPIC_API_KEY   Your Anthropic API key (required)

Examples:
  PLEX_TOKEN=abc ANTHROPIC_API_KEY=sk-ant-... tinkerbell generate
  tinkerbell generate --token abc --section Movies
        `.trim());
    }

    const { values: args } = parseArgs({
        options: {
            url:     { type: "string",  short: "u" },
            token:   { type: "string",  short: "t" },
            section: { type: "string",  short: "s" },
            limit:   { type: "string",  short: "l" },
            verbose: { type: "boolean", short: "v", default: false },
            help:    { type: "boolean", short: "h", default: false },
        },
        strict: true,
        allowPositionals: true,
    });

    if (args.help) {
        printGenerateUsage();
        process.exit(0);
    }

    const PLEX_URL   = (args.url || process.env.PLEX_URL || "http://localhost:32400").replace(/\/+$/, "");
    const PLEX_TOKEN = args.token || process.env.PLEX_TOKEN;
    const MAX_COLLECTIONS = Math.max(1, parseInt(args.limit, 10) || 8);
    const VERBOSE    = args.verbose;

    if (!PLEX_TOKEN) {
        console.error("Error: Plex token is required. Use --token or set PLEX_TOKEN.");
        process.exit(1);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
        process.exit(1);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    const log = (...a) => VERBOSE && console.log("  ", ...a);

    async function plex(path, { method = "GET", params = {}, headers = {} } = {}) {
        const url = new URL(path, PLEX_URL);
        url.searchParams.set("X-Plex-Token", PLEX_TOKEN);
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        }

        log(`${method} ${url.pathname}${url.search.replace(PLEX_TOKEN, "***")}`);

        const res = await fetch(url.toString(), {
            method,
            headers: {
                Accept: "application/json",
                "X-Plex-Client-Identifier": "tinkerbell",
                "X-Plex-Product": "tinkerbell",
                "X-Plex-Version": "1.0.0",
                ...headers,
            },
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
        }

        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    async function getSections() {
        const data = await plex("/library/sections");
        return data.MediaContainer.Directory || [];
    }

    async function getMachineIdentifier() {
        const data = await plex("/");
        return data.MediaContainer.machineIdentifier;
    }

    // ─── Delete previous tinkerbell collections ─────────────────────────────────

    const TINKERBELL_MARKER = "[tinkerbell]";

    async function deleteTinkerbellCollections(sectionId) {
        const data = await plex(`/library/sections/${sectionId}/all`, {
            params: { type: 18 },
        });
        const collections = data?.MediaContainer?.Metadata || [];

        let deleted = 0;
        for (const col of collections) {
            let isTinkerbell = col.summary?.includes(TINKERBELL_MARKER);

            if (!isTinkerbell) {
                const detail = await plex(`/library/metadata/${col.ratingKey}`);
                const labels = detail?.MediaContainer?.Metadata?.[0]?.Label || [];
                isTinkerbell = labels.some((l) => l.tag.toLowerCase() === "tinkerbell");
            }

            if (isTinkerbell) {
                log(`Deleting collection "${col.title}" (${col.ratingKey})`);
                await plex(`/library/metadata/${col.ratingKey}`, { method: "DELETE" });
                deleted++;
            }
        }
        return deleted;
    }

    // ─── Fetch all items in a section (paginated) ───────────────────────────────

    async function fetchAllItems(sectionId) {
        const items = [];
        const pageSize = 100;
        let offset = 0;

        while (true) {
            const data = await plex(`/library/sections/${sectionId}/all`, {
                params: {
                    "X-Plex-Container-Start": offset,
                    "X-Plex-Container-Size": pageSize,
                },
            });

            const batch = data?.MediaContainer?.Metadata || [];
            if (batch.length === 0) break;

            for (const item of batch) {
                items.push({
                    ratingKey: item.ratingKey,
                    title: item.title,
                    year: item.year,
                });
            }

            offset += batch.length;
            const total = data?.MediaContainer?.totalSize ?? 0;
            if (offset >= total) break;
        }

        return items;
    }

    // ─── Ask Claude for curated collections ─────────────────────────────────────

    async function generateCollections(items, sectionTitle, maxCollections) {
        const anthropic = new Anthropic();

        const shuffled = [...items];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const itemList = shuffled.map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`).join("\n");

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
- Each collection should have between 10 and 30 items
- Each item can appear in multiple collections
- Only use titles that exactly match the input list
- Collection names should be creative and fun, but NEVER use colons in names (no "Title: Subtitle" format)
- Each collection needs a short description (one sentence)
- Be surprising and inventive with your themes — avoid obvious genres or decades groupings
- Think of unexpected connections between items: tonal similarities, visual motifs, narrative parallels, thematic undercurrents, shared vibes

Random seed for variety: ${seed}

Return ONLY valid JSON, no markdown fences, no explanation. Format:
[{"name": "Collection Name", "description": "Short description.", "items": ["Title (Year)", "Title (Year)"]}]

Here are the items:
${itemList}`,
                },
            ],
        });

        const text = response.content[0].text.trim();
        try {
            return JSON.parse(text);
        } catch {
            // Try extracting JSON from markdown fences
            const match = text.match(/\[[\s\S]*\]/);
            if (match) return JSON.parse(match[0]);
            throw new Error("Failed to parse AI response as JSON");
        }
    }

    // ─── Create a collection in Plex ────────────────────────────────────────────

    const SECTION_TYPE_MAP = { movie: 1, show: 2, artist: 8, photo: 13 };

    async function createCollection(sectionId, sectionType, machineId, name, description, ratingKeys) {
        if (ratingKeys.length === 0) return null;

        // Create collection with all items in a single request
        const uri = `server://${machineId}/com.plexapp.plugins.library/library/metadata/${ratingKeys.join(",")}`;

        const data = await plex("/library/collections", {
            method: "POST",
            params: {
                type: SECTION_TYPE_MAP[sectionType] || 1,
                title: name,
                smart: 0,
                sectionId,
                uri,
                summary: `${description} ${TINKERBELL_MARKER}`,
            },
        });

        const collectionKey = data?.MediaContainer?.Metadata?.[0]?.ratingKey;
        if (!collectionKey) throw new Error(`Failed to create collection "${name}"`);

        // Label with "Tinkerbell"
        await plex(`/library/sections/${sectionId}/all`, {
            method: "PUT",
            params: {
                type: 18,
                id: collectionKey,
                "label[0].tag.tag": "Tinkerbell",
                "label.locked": 1,
            },
        });

        return collectionKey;
    }

    // ─── Pin collection to homepage ─────────────────────────────────────────────

    async function pinToHomepage(sectionId, collectionKey) {
        // Register the collection as a managed hub
        await plex(`/hubs/sections/${sectionId}/manage`, {
            method: "POST",
            params: { metadataItemId: collectionKey },
        });

        const hubIdentifier = `custom.collection.${sectionId}.${collectionKey}`;
        log(`Promoting hub ${hubIdentifier}`);

        // Promote it to home screens
        await plex(`/hubs/sections/${sectionId}/manage/${hubIdentifier}`, {
            method: "PUT",
            params: {
                promotedToOwnHome: 1,
                promotedToRecommendedHome: 1,
                promotedToSharedHome: 1,
            },
        });
        return true;
    }

    // ─── Process a single section ───────────────────────────────────────────────

    async function processSection(section, machineId) {
        const sectionId = section.key;
        const sectionTitle = section.title;

        console.log(`\n📚 "${sectionTitle}" — starting...`);

        // Step 1: Delete old tinkerbell collections
        console.log(`   🗑  Deleting previous tinkerbell collections...`);
        const deleted = await deleteTinkerbellCollections(sectionId);
        console.log(`   🗑  Deleted ${deleted} old collection(s).`);

        // Step 2: Fetch all items
        console.log(`   📥 Fetching library items...`);
        const items = await fetchAllItems(sectionId);
        console.log(`   📥 Found ${items.length} item(s).`);

        if (items.length < 10) {
            console.log(`   ⏭  Too few items to generate collections, skipping.`);
            return;
        }

        // Step 3: Ask AI for collections
        console.log(`   🤖 Asking Claude for curated collections...`);
        const aiCollections = await generateCollections(items, sectionTitle, MAX_COLLECTIONS);
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

            if (ratingKeys.length < 2) {
                log(`Skipping "${col.name}" — only ${ratingKeys.length} matching item(s)`);
                continue;
            }

            console.log(`   📦 Creating "${col.name}" (${ratingKeys.length} items)...`);

            const collectionKey = await createCollection(
                sectionId, section.type, machineId, col.name, col.description, ratingKeys
            );

            if (collectionKey) {
                const pinned = await pinToHomepage(sectionId, collectionKey);
                if (pinned) {
                    log(`Pinned "${col.name}" to homepage`);
                } else {
                    log(`Created "${col.name}" but could not pin to homepage`);
                }
                created++;
            }
        }

        console.log(`   ✅ Created and pinned ${created} collection(s) for "${sectionTitle}".`);
    }

    // ─── Main ───────────────────────────────────────────────────────────────────

    async function main() {
        console.log(`🧚 tinkerbell generate`);
        console.log(`   Server: ${PLEX_URL}`);

        let machineId;
        try {
            const identity = await plex("/");
            machineId = identity.MediaContainer.machineIdentifier;
            console.log(`   Server name: ${identity.MediaContainer.friendlyName}`);
        } catch (err) {
            console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
            console.error(`   ${err.message}`);
            process.exit(1);
        }

        const allSections = await getSections();

        let sections;
        if (args.section) {
            const match = allSections.find(
                (s) =>
                    s.key === args.section ||
                    s.title.toLowerCase() === args.section.toLowerCase()
            );
            if (!match) {
                console.error(`\n❌ Section "${args.section}" not found.`);
                console.error("   Available sections:");
                allSections.forEach((s) => console.error(`     [${s.key}] ${s.title} (${s.type})`));
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

    main().catch((err) => {
        console.error(`\n❌ Fatal error: ${err.message}`);
        if (VERBOSE) console.error(err.stack);
        process.exit(1);
    });
}

// ─── Sub-command: cleanup ───────────────────────────────────────────────────────

else if (command === "cleanup") {
    function printCleanupUsage() {
        console.log(`
tinkerbell cleanup — Delete tinkerbell-generated collections.

Removes collections previously created by "tinkerbell generate".
Use --all to remove ALL collections in a section (useful if broken
collections are preventing Plex from loading).

Usage:
  tinkerbell cleanup [options]

Options:
  --section, -s    Library section name/ID   (omit to clean ALL sections)
  --from, -f       Delete collections added on or after this date (YYYY-MM-DD)
  --all, -a        Delete ALL collections, not just tinkerbell ones

Global options:
  --url, -u        Plex server URL          (env: PLEX_URL, default: http://localhost:32400)
  --token, -t      Plex auth token           (env: PLEX_TOKEN, required)
  --verbose, -v    Show detailed output      (default: false)
  --help, -h       Show this help message

Examples:
  tinkerbell cleanup --token abc
  tinkerbell cleanup --token abc --section Movies --all
        `.trim());
    }

    const { values: args } = parseArgs({
        options: {
            url:     { type: "string",  short: "u" },
            token:   { type: "string",  short: "t" },
            section: { type: "string",  short: "s" },
            from:    { type: "string",  short: "f" },
            all:     { type: "boolean", short: "a", default: false },
            verbose: { type: "boolean", short: "v", default: false },
            help:    { type: "boolean", short: "h", default: false },
        },
        strict: true,
        allowPositionals: true,
    });

    if (args.help) {
        printCleanupUsage();
        process.exit(0);
    }

    const PLEX_URL   = (args.url || process.env.PLEX_URL || "http://localhost:32400").replace(/\/+$/, "");
    const PLEX_TOKEN = args.token || process.env.PLEX_TOKEN;
    const DELETE_ALL = args.all;
    const FROM_DATE  = args.from ? Math.floor(new Date(args.from).getTime() / 1000) : null;
    const VERBOSE    = args.verbose;

    if (args.from && !FROM_DATE) {
        console.error("Error: Invalid date for --from. Use YYYY-MM-DD format.");
        process.exit(1);
    }

    if (!PLEX_TOKEN) {
        console.error("Error: Plex token is required. Use --token or set PLEX_TOKEN.");
        process.exit(1);
    }

    const log = (...a) => VERBOSE && console.log("  ", ...a);

    async function plex(path, { method = "GET", params = {} } = {}) {
        const url = new URL(path, PLEX_URL);
        url.searchParams.set("X-Plex-Token", PLEX_TOKEN);
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
        }

        log(`${method} ${url.pathname}${url.search.replace(PLEX_TOKEN, "***")}`);

        const res = await fetch(url.toString(), {
            method,
            headers: {
                Accept: "application/json",
                "X-Plex-Client-Identifier": "tinkerbell",
                "X-Plex-Product": "tinkerbell",
                "X-Plex-Version": "1.0.0",
            },
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Plex API ${method} ${path} → ${res.status} ${res.statusText}\n${body}`);
        }

        const text = await res.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    async function getSections() {
        const data = await plex("/library/sections");
        return data.MediaContainer.Directory || [];
    }

    async function cleanupSection(section) {
        const sectionId = section.key;
        const sectionTitle = section.title;

        console.log(`\n🧹 "${sectionTitle}" — fetching collections...`);

        const data = await plex(`/library/sections/${sectionId}/all`, {
            params: { type: 18 },
        });
        const collections = data?.MediaContainer?.Metadata || [];

        if (collections.length === 0) {
            console.log(`   No collections found.`);
            return 0;
        }

        console.log(`   Found ${collections.length} collection(s).`);

        let deleted = 0;
        for (const col of collections) {
            if (DELETE_ALL) {
                console.log(`   🗑  "${col.title}" — deleted`);
                await plex(`/library/metadata/${col.ratingKey}`, { method: "DELETE" });
                deleted++;
                continue;
            }

            const hasSummaryMarker = col.summary?.includes("[tinkerbell]");
            let hasLabel = false;
            if (!hasSummaryMarker) {
                const detail = await plex(`/library/metadata/${col.ratingKey}`);
                const labels = detail?.MediaContainer?.Metadata?.[0]?.Label || [];
                hasLabel = labels.some((l) => l.tag.toLowerCase() === "tinkerbell");
            }

            const isTinkerbell = hasSummaryMarker || hasLabel;
            const isAfterFrom = FROM_DATE && col.addedAt >= FROM_DATE;

            if (DELETE_ALL || isTinkerbell || isAfterFrom) {
                console.log(`   🗑  "${col.title}" — deleted`);
                await plex(`/library/metadata/${col.ratingKey}`, { method: "DELETE" });
                deleted++;
            } else {
                console.log(`   ⏭  "${col.title}" — skipped`);
            }
        }

        console.log(`   ✅ Deleted ${deleted} collection(s) from "${sectionTitle}".`);
        return deleted;
    }

    async function main() {
        console.log(`🧹 tinkerbell cleanup${DELETE_ALL ? " (ALL collections)" : ""}`);
        console.log(`   Server: ${PLEX_URL}`);

        try {
            const identity = await plex("/");
            console.log(`   Server name: ${identity.MediaContainer.friendlyName}`);
        } catch (err) {
            console.error(`\n❌ Could not connect to Plex server at ${PLEX_URL}`);
            console.error(`   ${err.message}`);
            process.exit(1);
        }

        const allSections = await getSections();

        let sections;
        if (args.section) {
            const match = allSections.find(
                (s) =>
                    s.key === args.section ||
                    s.title.toLowerCase() === args.section.toLowerCase()
            );
            if (!match) {
                console.error(`\n❌ Section "${args.section}" not found.`);
                console.error("   Available sections:");
                allSections.forEach((s) => console.error(`     [${s.key}] ${s.title} (${s.type})`));
                process.exit(1);
            }
            sections = [match];
        } else {
            sections = allSections;
        }

        console.log(`   Sections: ${sections.map((s) => s.title).join(", ")}`);

        let total = 0;
        for (const section of sections) {
            total += await cleanupSection(section);
        }

        console.log(`\n🎉 Done! Deleted ${total} collection(s) total.`);
    }

    main().catch((err) => {
        console.error(`\n❌ Fatal error: ${err.message}`);
        if (VERBOSE) console.error(err.stack);
        process.exit(1);
    });
} else {
    console.error(`Unknown command: ${command}`);
    console.error('Run "tinkerbell --help" for available commands.');
    process.exit(1);
}

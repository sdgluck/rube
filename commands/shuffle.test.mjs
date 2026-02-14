import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPlexClient } from "../plex.mjs";

const PLEX_URL = (process.env.PLEX_URL || "http://localhost:32400").replace(
  /\/+$/,
  "",
);
const PLEX_TOKEN = process.env.PLEX_TOKEN;

if (!PLEX_TOKEN) {
  console.error("PLEX_TOKEN is required. Set it as an environment variable.");
  process.exit(1);
}

const client = createPlexClient({
  url: PLEX_URL,
  token: PLEX_TOKEN,
  verbose: false,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isCustomHub(hub) {
  return hub.identifier.startsWith("custom.");
}

function countMismatches(desired, actual) {
  let n = 0;
  for (let i = 0; i < Math.max(desired.length, actual.length); i++) {
    if (desired[i]?.identifier !== actual[i]?.identifier) n++;
  }
  return n;
}

// Reorder only custom hubs, leaving system hubs in place
async function reorderCustomOnly(sectionId, desired) {
  const MAX_ATTEMPTS = 8;
  const SETTLE_DELAY = 3000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt === 1) {
      for (let i = 0; i < desired.length; i++) {
        if (!isCustomHub(desired[i])) continue;
        const afterId = i === 0 ? "" : desired[i - 1].identifier;
        await client.moveHub(sectionId, desired[i].identifier, afterId);
      }
    } else {
      const current = await client.getManagedHubs(sectionId);
      let fixes = 0;
      for (let i = 0; i < desired.length; i++) {
        if (!isCustomHub(desired[i])) continue;
        if (current[i]?.identifier !== desired[i].identifier) {
          const afterId = i === 0 ? "" : desired[i - 1].identifier;
          await client.moveHub(sectionId, desired[i].identifier, afterId);
          fixes++;
        }
      }
      if (fixes === 0) {
        console.log("    Attempt " + attempt + ": 0 mismatches");
        return 0;
      }
    }

    await sleep(SETTLE_DELAY);

    const actual = await client.getManagedHubs(sectionId);
    const m = countMismatches(desired, actual);
    console.log(
      "    Attempt " +
        attempt +
        ": " +
        m +
        "/" +
        desired.length +
        " mismatches",
    );
    if (m === 0) return 0;
  }

  const final = await client.getManagedHubs(sectionId);
  return countMismatches(desired, final);
}

// Build a new order: system hubs stay in place, custom hubs are shuffled
function buildShuffledOrder(hubs, shuffledCustom) {
  const result = [];
  let ci = 0;
  for (const hub of hubs) {
    if (isCustomHub(hub)) {
      result.push(shuffledCustom[ci++]);
    } else {
      result.push(hub);
    }
  }
  return result;
}

describe("shuffle with system hubs fixed", () => {
  let section;
  let originalOrder;

  before(async () => {
    const sections = await client.getSections();
    section = sections.find(
      (s) =>
        s.title.toLowerCase() === "films" || s.title.toLowerCase() === "movies",
    );
    if (!section) {
      console.log("No Films/Movies section found");
      process.exit(1);
    }

    originalOrder = await client.getManagedHubs(section.key);
    const sys = originalOrder.filter((h) => !isCustomHub(h));
    const cust = originalOrder.filter((h) => isCustomHub(h));
    console.log(
      "Using " +
        JSON.stringify(section.title) +
        ": " +
        sys.length +
        " system hubs, " +
        cust.length +
        " custom hubs\n",
    );
  });

  after(async () => {
    console.log("\n  Restoring...");
    const m = await reorderCustomOnly(section.key, originalOrder);
    console.log("  Restore: " + m + " mismatches");
  });

  it("reverses custom hubs (system stay in place)", async () => {
    const customHubs = originalOrder.filter((h) => isCustomHub(h));
    const reversedCustom = [...customHubs].reverse();
    const desired = buildShuffledOrder(originalOrder, reversedCustom);

    console.log("  System hubs at original positions, custom hubs reversed");
    const m = await reorderCustomOnly(section.key, desired);
    assert.equal(m, 0, m + " hubs still in wrong position");
  });

  it("random shuffle of custom hubs", async () => {
    const current = await client.getManagedHubs(section.key);
    const customHubs = current.filter((h) => isCustomHub(h));
    const shuffled = [...customHubs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const desired = buildShuffledOrder(current, shuffled);

    console.log("  System hubs at original positions, custom hubs shuffled");
    const m = await reorderCustomOnly(section.key, desired);
    assert.equal(m, 0, m + " hubs still in wrong position");
  });
});

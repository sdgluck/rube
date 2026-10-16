/**
 * Narrowing a rule's libraries must take down what it made in the ones it
 * dropped. A run reads and sweeps only the libraries it covers, so before
 * `removeOutOfScope` an AI rule moved from Films and TV to Films alone left
 * "Britcom Chaos Energy" in TV, under its label, indefinitely.
 *
 * Just as important is what it must not delete: a rule with no library list of
 * its own runs in the job's scope, which may be narrower than the server, so
 * everything outside that scope is still the rule's live output.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { MockPlex } from "../../test-support/mock-plex-server.ts";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { ConfigStoreToken, noopCheckpoint } from "@tinkerbell/core";
import { DbToken, rules } from "@tinkerbell/db";
import { createGenerateCommand } from "./index.ts";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createGenerateCommand(c.resolve(ServicesToken));
const { startMockPlex } = await import("../../test-support/mock-plex-server.ts");

const RULE_ID = "scope-rule";
const LABEL = `Rule:${RULE_ID}`;
const SECTIONS = [
  { key: "1", title: "Films", type: "movie" },
  { key: "2", title: "TV", type: "show" },
];
const ITEMS = ["100", "101", "102"].map((ratingKey, i) => ({
  ratingKey,
  title: `Horror ${i}`,
  sectionId: "1",
  genre: "Horror",
  guids: [],
  labels: [],
}));

let plex: MockPlex;

before(async () => {
  plex = await startMockPlex({ sections: SECTIONS, items: ITEMS });
  setConfig("global_plex_url", plex.origin);
  setConfig("global_plex_token", "token");
  setConfig("posters_kometa_enabled", false);
});
after(async () => {
  await plex?.close();
});

beforeEach(() => {
  plex.collections.clear();
  plex.journal.deletedCollections.length = 0;
  // What the rule made in TV back when it covered TV, and something of
  // somebody else's beside it.
  plex.collections.set("9001", {
    ratingKey: "9001",
    title: "Britcom Chaos Energy",
    sectionId: "2",
    labels: ["Tinkerbell", LABEL],
    memberKeys: [],
  });
  plex.collections.set("9002", {
    ratingKey: "9002",
    title: "Hand-made",
    sectionId: "2",
    labels: [],
    memberKeys: [],
  });
});

function seedRule(sections: string[] | undefined): void {
  db.delete(rules).run();
  db.insert(rules)
    .values({
      id: RULE_ID,
      name: "Scary films",
      type: "smart_filter",
      enabled: 1,
      createdAt: Date.now(),
      config: {
        smartFilter: {
          kind: "group",
          combinator: "all",
          children: [{ kind: "leaf", field: "genre", op: "=", value: "Horror" }],
        },
        collectionName: "Scary Films",
        pinToHomepage: false,
        ...(sections ? { sections } : {}),
      },
    })
    .run();
}

async function runJob(config: { sections?: string[] } = {}): Promise<void> {
  await run(
    {
      scope: c.createScope("test"),
      log: () => {},
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
    config,
  );
}

describe("a rule's libraries narrowed", () => {
  it("removes what it made in a library it no longer covers", async () => {
    seedRule(["Films"]);
    await runJob();
    assert.ok(!plex.collections.has("9001"), "the TV collection should be gone");
    assert.ok(plex.collections.has("9002"), "a collection without the rule's label stays");
    assert.ok([...plex.collections.values()].some((col) => col.title === "Scary Films" && col.sectionId === "1"));
  });

  it("leaves other libraries alone when the rule takes the job's scope", async () => {
    // No list of its own, run by a job scoped to Films: TV is outside this run,
    // not outside the rule.
    seedRule(undefined);
    await runJob({ sections: ["Films"] });
    assert.ok(plex.collections.has("9001"));
  });
});

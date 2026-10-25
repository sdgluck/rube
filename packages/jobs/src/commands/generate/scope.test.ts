/**
 * Scope and name template around a grouped handler. The bug they exist for:
 * "Horror Through the Decades" grouped the whole library, so its "2020s" held
 * every 2020s film, and was titled like any other rule's "2020s".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PlexClient } from "@rube/plex";
import { prepareHandlerRun } from "./scope.ts";
import type { HandlerDeps, PendingCollection } from "./types.ts";

const FILMS = { key: "1", title: "Films", type: "movie" };
const ITEMS = [
  { ratingKey: "10", title: "Smile 2", year: 2024 },
  { ratingKey: "11", title: "A Man Called Otto", year: 2022 },
  { ratingKey: "12", title: "Halloween", year: 1978 },
];
const HORROR = new Set(["10", "12"]);
const SCOPE = {
  kind: "group" as const,
  combinator: "all" as const,
  children: [{ kind: "leaf" as const, field: "genre", op: "=" as const, value: "Horror" }],
};

function fakeClient(queries: string[]): PlexClient {
  return {
    async *allItems() {
      for (const item of ITEMS) yield { item, totalSize: ITEMS.length };
    },
    async allItemsWithGuids() {
      return ITEMS.map((i) => ({ ...i, guids: [] }));
    },
    async fetchItemsByFilter(path: string) {
      queries.push(path);
      return ITEMS.filter((i) => HORROR.has(i.ratingKey));
    },
  } as unknown as PlexClient;
}

/** Groups by decade from the walk, as `yearGroupedHandler` does. */
async function* decades(deps: HandlerDeps): AsyncGenerator<PendingCollection> {
  const groups = new Map<string, PendingCollection["matched"]>();
  for await (const { item } of deps.client.allItems("1")) {
    const label = `${Math.floor((item.year as number) / 10) * 10}s`;
    groups.set(label, [
      ...(groups.get(label) ?? []),
      { ratingKey: item.ratingKey as string, title: item.title as string },
    ]);
  }
  for (const [name, matched] of groups) yield { name, section: FILMS, matched };
}

function deps(type: string, config: Record<string, unknown>, queries: string[] = []): HandlerDeps {
  return {
    ctx: { log: () => {} } as unknown as HandlerDeps["ctx"],
    client: fakeClient(queries),
    sections: [FILMS],
    rule: { id: "r", type } as HandlerDeps["rule"],
    ruleConfig: config as HandlerDeps["ruleConfig"],
  };
}

async function run(d: HandlerDeps): Promise<PendingCollection[]> {
  const { deps: prepared, handler } = prepareHandlerRun(d, decades);
  const out: PendingCollection[] = [];
  for await (const p of handler(prepared)) out.push(p);
  return out;
}

describe("prepareHandlerRun", () => {
  it("groups only what the scope matches, and asks Plex once per library", async () => {
    const queries: string[] = [];
    const out = await run(deps("decades", { scope: SCOPE }, queries));
    assert.deepEqual(
      out.map((p) => [p.name, p.matched.map((m) => m.title)]),
      [
        ["2020s", ["Smile 2"]],
        ["1970s", ["Halloween"]],
      ],
    );
    assert.equal(queries.length, 1);
    assert.match(queries[0], /^\/library\/sections\/1\/all\?type=1&genre=Horror$/);
  });

  it("narrows the guid walk too, which the TMDb and awards handlers read", async () => {
    const { deps: prepared } = prepareHandlerRun(deps("genres", { scope: SCOPE }), decades);
    const items = await prepared.client.allItemsWithGuids("1");
    assert.deepEqual(
      items.map((i) => i.ratingKey),
      ["10", "12"],
    );
  });

  it("titles each collection by the template and keeps the group for its summary", async () => {
    const out = await run(deps("decades", { scope: SCOPE, nameTemplate: "{name} Horror" }));
    assert.deepEqual(
      out.map((p) => [p.name, p.groupLabel]),
      [
        ["2020s Horror", "2020s"],
        ["1970s Horror", "1970s"],
      ],
    );
  });

  it("leaves a rule with neither, or a type that doesn't group, exactly as it was", async () => {
    const plain = deps("decades", {});
    assert.equal(prepareHandlerRun(plain, decades).deps, plain);
    const smart = deps("smart_filter", { scope: SCOPE, nameTemplate: "{name} Horror" });
    const prepared = prepareHandlerRun(smart, decades);
    assert.equal(prepared.deps, smart);
    assert.equal(prepared.handler, decades);
  });
});

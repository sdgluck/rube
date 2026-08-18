/**
 * Paging a section listing.
 *
 * The failure that matters here is silent: a walk that stops early reports a
 * plausible number for a library it only partly read, and every consumer — the
 * media index, the storage totals, the duplicate finder — trusts it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createPlexClient } from "./index.ts";

type Page = { items: number; totalSize?: number };

/** A Plex whose section listing serves `pages` in order. */
function mockPlex(pages: Page[]) {
  let served = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/identity") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ MediaContainer: { machineIdentifier: "m", friendlyName: "Test" } }));
      return;
    }
    const page = pages[served] ?? { items: 0 };
    served++;
    const start = Number(url.searchParams.get("X-Plex-Container-Start") ?? "0");
    const Metadata = Array.from({ length: page.items }, (_, i) => ({
      ratingKey: String(start + i + 1),
      title: `Item ${start + i + 1}`,
      type: "movie",
    }));
    const container: Record<string, unknown> = { Metadata };
    if (page.totalSize !== undefined) container.totalSize = page.totalSize;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ MediaContainer: container }));
  });
  return {
    async start(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, () => resolve()));
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    get pagesServed() {
      return served;
    },
  };
}

async function walk(url: string): Promise<number> {
  const client = createPlexClient({ url, token: "t" });
  let count = 0;
  for await (const _ of client.allItems("1")) count++;
  return count;
}

describe("allItems", () => {
  it("keeps paging when Plex reports no totalSize", async () => {
    // `totalSize ?? 0` made `offset >= totalSize` true on the first page, so a
    // listing without the field looked like a complete library of 100 items.
    const plex = mockPlex([{ items: 100 }, { items: 100 }, { items: 30 }]);
    const url = await plex.start();
    try {
      assert.equal(await walk(url), 230);
    } finally {
      await plex.close();
    }
  });

  it("stops on a short page even when the total claims more", async () => {
    // A section mid-scan reports a total it can no longer serve; paging forever
    // against an empty tail would wedge the sync.
    const plex = mockPlex([
      { items: 100, totalSize: 5000 },
      { items: 4, totalSize: 5000 },
    ]);
    const url = await plex.start();
    try {
      assert.equal(await walk(url), 104);
    } finally {
      await plex.close();
    }
  });

  it("stops at the reported total", async () => {
    const plex = mockPlex([
      { items: 100, totalSize: 100 },
      { items: 100, totalSize: 100 },
    ]);
    const url = await plex.start();
    try {
      assert.equal(await walk(url), 100);
      assert.equal(plex.pagesServed, 1, "no request for a page beyond the total");
    } finally {
      await plex.close();
    }
  });

  it("an empty section yields nothing", async () => {
    const plex = mockPlex([{ items: 0, totalSize: 0 }]);
    const url = await plex.start();
    try {
      assert.equal(await walk(url), 0);
    } finally {
      await plex.close();
    }
  });
});

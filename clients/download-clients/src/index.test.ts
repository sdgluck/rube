/**
 * Every client against a mock of its own app, over real HTTP.
 *
 * The table at the top runs the same contract against all five — read the
 * queue, pause and resume the client, pause and resume one item, refuse bad
 * credentials — because the whole point of the shared interface is that the
 * Downloads page can't tell them apart. Below it, each app's own trap: the
 * handshake, the renamed endpoint, the id an *Arr knows an item by.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import {
  createMockDeluge,
  createMockNzbget,
  createMockQbittorrent,
  createMockSabnzbd,
  createMockTransmission,
  type MockDownload,
  type MockDownloadClient,
} from "@tinkerbell/test-support/download-clients";
import type { DownloadClientKind } from "@tinkerbell/contracts";
import { apiAtLeast, createDownloadClient, DownloadClientError, rpcPath, type DownloadClientConfig } from "./index.ts";

const GB = 1024 ** 3;

interface Case {
  kind: DownloadClientKind;
  ids: [string, string];
  mock: (items: MockDownload[]) => Promise<MockDownloadClient>;
  config: (origin: string) => DownloadClientConfig;
  wrong: (origin: string) => DownloadClientConfig;
}

const CASES: Case[] = [
  {
    kind: "sabnzbd",
    ids: ["SABnzbd_nzo_aaa", "SABnzbd_nzo_bbb"],
    mock: (items) => createMockSabnzbd({ apiKey: "key", items }),
    config: (url) => ({ kind: "sabnzbd", url, secret: "key" }),
    wrong: (url) => ({ kind: "sabnzbd", url, secret: "nope" }),
  },
  {
    kind: "nzbget",
    ids: ["17", "18"],
    mock: (items) => createMockNzbget({ username: "nzbget", password: "pw", items }),
    config: (url) => ({ kind: "nzbget", url, username: "nzbget", secret: "pw" }),
    wrong: (url) => ({ kind: "nzbget", url, username: "nzbget", secret: "nope" }),
  },
  {
    kind: "qbittorrent",
    ids: ["aaaa1111", "bbbb2222"],
    mock: (items) => createMockQbittorrent({ username: "admin", password: "pw", items }),
    config: (url) => ({ kind: "qbittorrent", url, username: "admin", secret: "pw" }),
    wrong: (url) => ({ kind: "qbittorrent", url, username: "admin", secret: "nope" }),
  },
  {
    kind: "transmission",
    ids: ["cccc3333", "dddd4444"],
    mock: (items) => createMockTransmission({ username: "t", password: "pw", items }),
    config: (url) => ({ kind: "transmission", url, username: "t", secret: "pw" }),
    wrong: (url) => ({ kind: "transmission", url, username: "t", secret: "nope" }),
  },
  {
    kind: "deluge",
    ids: ["eeee5555", "ffff6666"],
    mock: (items) => createMockDeluge({ password: "pw", items }),
    config: (url) => ({ kind: "deluge", url, secret: "pw" }),
    wrong: (url) => ({ kind: "deluge", url, secret: "nope" }),
  },
];

const mocks: MockDownloadClient[] = [];
after(() => Promise.all(mocks.map((m) => m.close())));

async function setUp(c: Case) {
  const mock = await c.mock([
    { id: c.ids[0], name: "Family.2024.1080p", done: 0.25, size: 8 * GB, paused: false },
    { id: c.ids[1], name: "Other.2023.2160p", done: 0, size: 20 * GB, paused: false },
  ]);
  mocks.push(mock);
  return { mock, client: createDownloadClient(c.config(mock.origin)) };
}

for (const c of CASES) {
  describe(c.kind, () => {
    test("reads the queue in the shared vocabulary", async () => {
      const { client } = await setUp(c);
      const { status, items } = await client.snapshot();

      assert.equal(status.paused, false);
      assert.ok(status.version, "a version is reported");
      assert.deepEqual(
        items.map((i) => i.id),
        c.ids,
      );
      const [first] = items;
      assert.equal(first!.state, "downloading");
      assert.equal(first!.paused, false);
      assert.ok(Math.abs(first!.progress! - 0.25) < 0.01, `progress ${first!.progress}`);
      assert.ok(Math.abs(first!.size! - 8 * GB) / GB < 0.01, `size ${first!.size}`);
      assert.ok(Math.abs(first!.sizeLeft! - 6 * GB) / GB < 0.01, `left ${first!.sizeLeft}`);
      assert.ok(first!.matchIds.includes(c.ids[0].toLowerCase()));
    });

    test("pausing the client leaves nothing reading as downloading, and resume undoes it", async () => {
      const { client, mock } = await setUp(c);

      await client.pause();
      const paused = await client.snapshot();
      assert.equal(paused.status.paused, true);
      assert.deepEqual(
        paused.items.map((i) => i.state),
        ["paused", "paused"],
      );

      await client.resume();
      assert.equal((await client.snapshot()).status.paused, false);
      assert.deepEqual(mock.journal.actions, ["pause", "resume"]);
    });

    test("one item pauses and resumes alone", async () => {
      const { client, mock } = await setUp(c);

      await client.pauseItem(c.ids[1]);
      const after = await client.snapshot();
      assert.equal(after.status.paused, false, "the client is not paused");
      assert.deepEqual(
        after.items.map((i) => i.paused),
        [false, true],
      );
      assert.equal(after.items[1]!.state, "paused");

      await client.resumeItem(c.ids[1]);
      assert.equal((await client.snapshot()).items[1]!.paused, false);
      assert.deepEqual(mock.journal.actions, [`pauseItem:${c.ids[1]}`, `resumeItem:${c.ids[1]}`]);
    });

    test("wrong credentials are an error, not an empty queue", async () => {
      const { mock } = await setUp(c);
      const client = createDownloadClient(c.wrong(mock.origin));
      await assert.rejects(() => client.snapshot(), DownloadClientError);
      await assert.rejects(() => client.test(), DownloadClientError);
    });
  });
}

describe("transport", () => {
  test("an unreachable host says which host", async () => {
    const client = createDownloadClient({ kind: "sabnzbd", url: "http://127.0.0.1:1", secret: "k" });
    await assert.rejects(() => client.test(), /127\.0\.0\.1:1/);
  });

  test("a URL base is kept rather than replaced", async () => {
    const mock = await createMockSabnzbd({ apiKey: "key" });
    mocks.push(mock);
    await createDownloadClient({ kind: "sabnzbd", url: `${mock.origin}/sabnzbd`, secret: "key" }).test();
    assert.match(mock.journal.requests.at(-1)!, /^GET \/sabnzbd\/api\?/);
  });
});

describe("sabnzbd", () => {
  test("a paused queue reads its active item as paused, but only the item paused itself offers resume", async () => {
    const mock = await createMockSabnzbd({
      apiKey: "key",
      items: [
        { id: "a", name: "A", done: 0, size: GB, paused: false },
        { id: "b", name: "B", done: 0, size: GB, paused: true },
      ],
    });
    mocks.push(mock);
    mock.state.paused = true;
    const { items } = await createDownloadClient({ kind: "sabnzbd", url: mock.origin, secret: "key" }).snapshot();
    assert.deepEqual(
      items.map((i) => [i.state, i.paused]),
      [
        ["paused", false],
        ["paused", true],
      ],
    );
  });
});

describe("nzbget", () => {
  test("an item answers to the drone id an *Arr reports as well as its NZB id", async () => {
    const mock = await createMockNzbget({
      username: "u",
      password: "p",
      items: [{ id: "42", name: "A", done: 0, size: GB, paused: false, drone: "ABCDEF-1234" }],
    });
    mocks.push(mock);
    const { items } = await createDownloadClient({
      kind: "nzbget",
      url: mock.origin,
      username: "u",
      secret: "p",
    }).snapshot();
    assert.deepEqual(items[0]!.matchIds, ["42", "abcdef-1234"]);
  });
});

describe("qbittorrent", () => {
  test("logs in once and reuses the session", async () => {
    const mock = await createMockQbittorrent({ username: "a", password: "p", items: [] });
    mocks.push(mock);
    const client = createDownloadClient({ kind: "qbittorrent", url: mock.origin, username: "a", secret: "p" });
    await client.snapshot();
    await client.snapshot();
    await client.pause();
    assert.equal(mock.journal.logins, 1);
  });

  test("qBittorrent 4 is paused and resumed on the old endpoints", async () => {
    const mock = await createMockQbittorrent({
      username: "a",
      password: "p",
      webApiVersion: "2.9.3",
      items: [{ id: "h1", name: "A", done: 0.5, size: GB, paused: false }],
    });
    mocks.push(mock);
    const client = createDownloadClient({ kind: "qbittorrent", url: mock.origin, username: "a", secret: "p" });
    await client.pauseItem("h1");
    assert.ok(mock.journal.requests.includes("POST /api/v2/torrents/pause"));
    assert.equal((await client.snapshot()).items[0]!.state, "paused");
  });

  test("a finished, paused torrent is completed rather than a stuck download", async () => {
    const mock = await createMockQbittorrent({
      username: "a",
      password: "p",
      items: [{ id: "h1", name: "A", done: 1, size: GB, paused: true }],
    });
    mocks.push(mock);
    const { items } = await createDownloadClient({
      kind: "qbittorrent",
      url: mock.origin,
      username: "a",
      secret: "p",
    }).snapshot();
    assert.equal(items[0]!.state, "completed");
  });

  test("web API versions compare numerically", () => {
    assert.equal(apiAtLeast("2.11.2", [2, 11]), true);
    assert.equal(apiAtLeast("2.9.3", [2, 11]), false);
    assert.equal(apiAtLeast("3.0", [2, 11]), true);
  });
});

describe("transmission", () => {
  test("the 409 session handshake happens once, then the id is reused", async () => {
    const mock = await createMockTransmission({ items: [] });
    mocks.push(mock);
    const client = createDownloadClient({ kind: "transmission", url: mock.origin });
    await client.snapshot();
    await client.pause();
    // One refused call, then every call carries the id.
    const rpcCalls = mock.journal.requests.filter((r) => r === "POST /transmission/rpc").length;
    assert.equal(rpcCalls, 1 + 3, "torrent-get, session-get and torrent-stop, plus the one refused call");
  });

  test("the RPC path follows the URL it was given", () => {
    assert.equal(rpcPath(new URL("http://h:9091/")), "transmission/rpc");
    assert.equal(rpcPath(new URL("http://h:9091/transmission/")), "rpc");
    assert.equal(rpcPath(new URL("http://h:9091/transmission/rpc/")), "");
  });
});

describe("deluge", () => {
  test("Deluge 1.3, without the plural torrent methods, still pauses an item", async () => {
    const mock = await createMockDeluge({
      password: "p",
      legacy: true,
      items: [{ id: "h1", name: "A", done: 0.5, size: GB, paused: false }],
    });
    mocks.push(mock);
    const client = createDownloadClient({ kind: "deluge", url: mock.origin, secret: "p" });
    await client.pauseItem("h1");
    assert.equal((await client.snapshot()).items[0]!.paused, true);
  });

  test("an errored torrent carries its message", async () => {
    const mock = await createMockDeluge({
      password: "p",
      items: [{ id: "h1", name: "A", done: 0.5, size: GB, paused: false, error: "No space left on device" }],
    });
    mocks.push(mock);
    const { items } = await createDownloadClient({ kind: "deluge", url: mock.origin, secret: "p" }).snapshot();
    assert.deepEqual([items[0]!.state, items[0]!.message], ["error", "No space left on device"]);
  });
});

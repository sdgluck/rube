/**
 * The domain over the real container and mock clients.
 *
 * What it adds to the clients themselves is worth pinning: one dead client
 * must not take the overview down with it, finished torrents stay out of a
 * page that polls, a session survives between polls but not a change of
 * credentials, and a test of a saved client works from the redacted secret the
 * settings form echoes back.
 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ConfigStoreToken, REDACTED_SECRET } from "@tinkerbell/core";
import { createMockQbittorrent, createMockSabnzbd } from "@tinkerbell/test-support/download-clients";
import { DownloadClientsToken, UnknownDownloadClientError } from "@tinkerbell/domain.download-clients";

const GB = 1024 ** 3;

const c = createTestContainer();
const sab = await createMockSabnzbd({
  apiKey: "sab-key",
  items: [{ id: "SABnzbd_nzo_1", name: "Family.2024", done: 0, size: 8 * GB, paused: false }],
});
const qbit = await createMockQbittorrent({
  username: "admin",
  password: "pw",
  items: [
    { id: "aaaa", name: "Downloading", done: 0.5, size: GB, paused: false },
    { id: "bbbb", name: "Seeding", done: 1, size: GB, paused: false },
  ],
});
after(async () => {
  await Promise.all([sab.close(), qbit.close()]);
  c.dispose();
});

const { setConfig } = c.resolve(ConfigStoreToken);
const downloads = c.resolve(DownloadClientsToken);

function configure(qbitPassword = "pw") {
  setConfig("global_download_clients", [
    { id: "sab", kind: "sabnzbd", name: "SAB", url: sab.origin, secret: "sab-key" },
    { id: "qbit", kind: "qbittorrent", name: "qBit", url: qbit.origin, username: "admin", secret: qbitPassword },
    { id: "dead", kind: "transmission", name: "Gone", url: "http://127.0.0.1:1" },
  ]);
}

beforeEach(() => configure());

test("an unreachable client is a row saying so, beside the ones that answered", async () => {
  const overview = await downloads.downloadClientsOverview();
  assert.deepEqual(
    overview.map((o) => [o.id, o.ok]),
    [
      ["sab", true],
      ["qbit", true],
      ["dead", false],
    ],
  );
  const dead = overview[2]!;
  assert.ok(!dead.ok && /127\.0\.0\.1:1/.test(dead.error));
});

test("finished torrents are left out", async () => {
  const qb = (await downloads.downloadClientsOverview()).find((o) => o.id === "qbit")!;
  assert.ok(qb.ok);
  assert.deepEqual(
    qb.items.map((i) => i.name),
    ["Downloading"],
  );
});

test("a session lasts between polls, and a new password gets a new one", async () => {
  const before = qbit.journal.logins;
  await downloads.downloadClientsOverview();
  await downloads.downloadClientsOverview();
  assert.ok(qbit.journal.logins - before <= 1, "at most one login across two polls");

  configure("changed");
  const overview = await downloads.downloadClientsOverview();
  assert.equal(overview.find((o) => o.id === "qbit")!.ok, false, "the new password was used, and refused");
});

test("pause and resume reach the client by id", async () => {
  await downloads.pauseDownloadClient("sab");
  await downloads.pauseDownload("qbit", "aaaa");
  await downloads.resumeDownloadClient("sab");
  assert.deepEqual(sab.journal.actions.slice(-2), ["pause", "resume"]);
  assert.deepEqual(qbit.journal.actions.slice(-1), ["pauseItem:aaaa"]);
});

test("an unknown id is refused rather than guessed at", async () => {
  await assert.rejects(() => downloads.pauseDownloadClient("nope"), UnknownDownloadClientError);
});

test("testing a saved client fills in its redacted secret", async () => {
  const version = await downloads.testDownloadClient({
    id: "sab",
    kind: "sabnzbd",
    url: sab.origin,
    secret: REDACTED_SECRET,
  });
  assert.equal(version, "4.3.2");
});

test("the list carries no credentials", () => {
  const listed = downloads.listDownloadClients();
  assert.deepEqual(Object.keys(listed[0]!).sort(), ["id", "kind", "name"]);
});

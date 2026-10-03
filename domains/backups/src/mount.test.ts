import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { backupDirMount } from "./mount.ts";

const scratch = mkdtempSync(join(tmpdir(), "tb-backup-mount-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A filesystem where everything under `/volume` is a second device. */
const twoDevices = async (path: string) => ({ dev: path.startsWith("/volume") ? 2 : 1 });

describe("backupDirMount", () => {
  test("says nothing outside a container, where the comparison means nothing", async () => {
    assert.equal(await backupDirMount(scratch, { inContainer: false }), null);
  });

  test("a directory on the root's own device is inside the container", async () => {
    // The scratch dir and its parent share a device on any test machine.
    assert.equal(await backupDirMount(scratch, { inContainer: true, root: tmpdir() }), "container");
  });

  test("a directory on another device is a mount", async () => {
    assert.equal(await backupDirMount("/volume/backups", { inContainer: true, stat: twoDevices }), "mounted");
    assert.equal(await backupDirMount("/config/backups", { inContainer: true, stat: twoDevices }), "container");
  });

  test("a directory that doesn't exist yet is judged by the ancestor it will be created in", async () => {
    const missing = join(scratch, "not", "yet", "made");
    assert.equal(await backupDirMount(missing, { inContainer: true, root: tmpdir() }), "container");

    const seen: string[] = [];
    const onVolume = async (path: string) => {
      seen.push(path);
      if (path === "/volume") return { dev: 2 };
      if (path === "/") return { dev: 1 };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    assert.equal(await backupDirMount("/volume/a/b", { inContainer: true, stat: onVolume }), "mounted");
    assert.deepEqual(seen, ["/volume/a/b", "/volume/a", "/volume", "/"]);
  });

  test("reads the real filesystem by default", async () => {
    const { dev } = await stat(scratch);
    assert.equal(typeof dev, "number");
    assert.ok((await backupDirMount(scratch, { inContainer: true })) !== null);
  });
});

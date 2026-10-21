/**
 * The portal preroll end to end: queue the card, run the real
 * `preroll-process` job with real ffmpeg, and check what reached a mock Plex's
 * `CinemaTrailersPrerollID`.
 *
 * The parts worth driving for real are the ones a unit test would agree with
 * itself about: that a `portal` row is rendered rather than probed as a
 * missing upload, that the encode is a file Plex would direct play, and that
 * the path written to Plex names it. Skipped where ffmpeg isn't installed —
 * the Docker image always has it.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Before anything resolves `prerollsDir()`: each test file is its own process,
// so this can't leak into another file's prerolls.
process.env.PREROLLS_DIR = mkdtempSync(join(tmpdir(), "tb-portal-preroll-"));

import type { JobContext } from "@rube/core";
import { ConfigStoreToken, noopCheckpoint } from "@rube/core";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { PortalUrlMissingError, processedPath, thumbPath } from "@rube/domain.prerolls";
import { probe } from "@rube/video";
import type { MockPlex } from "../test-support/mock-plex-server.ts";
import { createPrerollProcessCommand } from "./preroll-process.ts";

const { startMockPlex } = await import("../test-support/mock-plex-server.ts");

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const c = createTestContainer();
after(() => c.dispose());

const { prerolls } = c.resolve(ServicesToken);
const { setConfig } = c.resolve(ConfigStoreToken);
const { run } = createPrerollProcessCommand({ prerolls });

function ctx(): { ctx: JobContext; log: string[] } {
  const log: string[] = [];
  return {
    log,
    ctx: {
      scope: c.createScope("test"),
      log: (...args: unknown[]) => log.push(args.map(String).join(" ")),
      progress: () => {},
      signal: new AbortController().signal,
      checkpoint: noopCheckpoint,
    },
  };
}

describe("queueing the card", () => {
  it("refuses without an address to show", () => {
    assert.throws(() => prerolls.queuePortalPreroll(), PortalUrlMissingError);
    assert.equal(prerolls.getPortalPreroll(), undefined);
  });

  it("falls back to the portal's public URL, and a card's own address wins", () => {
    setConfig("user_app_public_url", "https://portal.example.com");
    assert.equal(prerolls.portalCardContent().url, "https://portal.example.com");
    assert.equal(prerolls.portalCardContent({ url: "https://tv.example.com" }).url, "https://tv.example.com");
  });

  it("never puts a stored colour that isn't a hex into the frame", () => {
    const content = prerolls.portalCardContent({ accent: '"/><script>', background: "red" });
    assert.match(content.accent, /^#[0-9a-f]{6}$/i);
    assert.match(content.background, /^#[0-9a-f]{6}$/i);
  });

  it("requeues the one card instead of adding a second", () => {
    const first = prerolls.queuePortalPreroll();
    prerolls.setStatus(first.id, "ready");
    const second = prerolls.queuePortalPreroll();
    assert.equal(second.id, first.id);
    assert.equal(second.status, "pending");
    assert.equal(prerolls.listPrerolls().filter((p) => p.kind === "portal").length, 1);
  });
});

describe("rendering it", { skip: !hasFfmpeg() && "ffmpeg is not installed" }, () => {
  let plex: MockPlex;

  before(async () => {
    plex = await startMockPlex({ sections: [], items: [] });
    setConfig("global_plex_url", plex.origin);
    setConfig("global_plex_token", "test-token");
    setConfig("prerolls_plex_path", "/plex/prerolls");
    setConfig("portal_preroll", { durationSeconds: 4, headline: "Pick your own home screen" });
  });
  after(() => plex.close());

  it("encodes a direct-playable clip of the configured length and tells Plex", async () => {
    const row = prerolls.queuePortalPreroll();
    const { ctx: jobCtx, log } = ctx();
    await run(jobCtx, {});

    const done = prerolls.getPreroll(row.id)!;
    assert.equal(done.status, "ready", log.join("\n"));
    assert.equal(done.transcodeAction, "render");
    assert.equal(done.videoCodec, "h264");
    // Silent, but present — see `stillArgs` for why.
    assert.equal(done.audioCodec, "aac");
    assert.equal(done.height, 1080);
    assert.ok(Math.abs(done.durationMs - 4000) < 250, `duration ${done.durationMs}`);

    const info = await probe(processedPath(row.id));
    assert.equal(info.video?.width, 1920);
    assert.ok(existsSync(thumbPath(row.id)), "a thumbnail is written");

    assert.equal(plex.prefs.get("CinemaTrailersPrerollID"), `/plex/prerolls/${row.id}.mp4`, log.join("\n"));
  });

  it("caps the frame at the transcoder's height ceiling", async () => {
    setConfig("prerolls_max_height", 720);
    const row = prerolls.queuePortalPreroll();
    await run(ctx().ctx, {});
    assert.equal(prerolls.getPreroll(row.id)!.height, 720);
    setConfig("prerolls_max_height", 1080);
  });

  it("removing it deletes the files", async () => {
    const row = prerolls.getPortalPreroll()!;
    assert.equal(await prerolls.removePortalPreroll(), true);
    assert.equal(prerolls.getPortalPreroll(), undefined);
    assert.equal(existsSync(processedPath(row.id)), false);
    assert.equal(await prerolls.removePortalPreroll(), false);
  });
});

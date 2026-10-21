/**
 * Readiness against the real container: each check reads the setting it
 * claims to, and flips when that setting does.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@rube/composition/test-support";
import { ServicesToken } from "@rube/composition";
import { ConfigStoreToken } from "@rube/core";
import { createReadiness } from "./readiness.ts";

const c = createTestContainer();
after(() => c.dispose());
const { setConfig } = c.resolve(ConfigStoreToken);
const { readinessFor } = createReadiness(c.resolve(ServicesToken));

const met = (jobId: string, command: string, config: Record<string, unknown> = {}) =>
  Object.fromEntries(readinessFor({ id: jobId, command, config }).map((i) => [i.id, i.met]));

describe("readiness", () => {
  it("asks every command job for Plex, and no in-process one", () => {
    assert.equal(met("sync-media", "sync-media").plex, false);
    setConfig("global_plex_url", "http://plex:32400");
    setConfig("global_plex_token", "t");
    assert.equal(met("sync-media", "sync-media").plex, true);
    assert.equal(met("healthcheck", "healthcheck").plex, undefined);
  });

  it("Because You Watched needs personalization and an AI provider", () => {
    assert.deepEqual(met("because-you-watched", "because-you-watched"), {
      plex: true,
      personalization: false,
      ai: false,
    });
    setConfig("global_personalized_sharing", { status: "enabled" });
    setConfig("global_llm", { provider: "anthropic", model: "m", apiKey: "k" });
    assert.deepEqual(met("because-you-watched", "because-you-watched"), {
      plex: true,
      personalization: true,
      ai: true,
    });
  });

  it("Digest only asks for what the enabled halves need", () => {
    const both = met("digest", "digest");
    assert.equal(both.smtp, false);
    assert.equal(both["digest-channel"], false);
    setConfig("global_smtp", { host: "smtp", port: 25, secure: false, from: "a@b.c" });
    assert.equal(met("digest", "digest").smtp, true);
    assert.equal(met("digest", "digest", { includeUserDigests: false }).smtp, undefined);
    assert.equal(met("digest", "digest", { includeServerDigest: false })["digest-channel"], undefined);
  });

  it("Backup follows its switch in Settings", () => {
    assert.equal(met("backup", "backup")["backups-enabled"], true);
    setConfig("backup_enabled", false);
    assert.equal(met("backup", "backup")["backups-enabled"], false);
  });

  it("Overlays needs an overlay configured", () => {
    assert.equal(met("overlays", "overlays")["overlay-configs"], false);
  });
});

/**
 * The first-run redirect is the most intrusive thing the app does to an admin,
 * so the only acceptable false positive is none.
 *
 * The state it latches on — started / skipped / dismissed — only exists once
 * somebody has interacted with the wizard, and an install that predates the
 * wizard has no row at all. So absence of that state cannot mean "new install",
 * and reading it that way sent working servers into first-run setup after an
 * upgrade.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This package doesn't depend on `@tinkerbell/db` — it reads through core and
// `domains/rules` — so the scratch database is migrated by spawning the migrate
// entrypoint by path rather than importing the package.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "tinkerbell-onboarding-redirect-test-"));
execFileSync(
  process.execPath,
  ["--experimental-strip-types", join(import.meta.dirname, "..", "..", "..", "packages", "db", "src", "migrate.ts")],
  { env: { ...process.env }, stdio: "ignore" },
);

const { setConfig, deleteConfig } = await import("@tinkerbell/core");
const { createRule, deleteRule, getRules } = await import("@tinkerbell/domain.rules");
const { getOnboardingStatus, startOnboarding, dismissOnboarding, skipOnboarding } = await import("./index.ts");

function connectPlex(): void {
  setConfig("global_plex_url", "http://plex.local:32400");
  setConfig("global_plex_token", "token");
}

beforeEach(() => {
  for (const rule of getRules()) deleteRule(rule.id);
  deleteConfig("onboarding_state");
  deleteConfig("global_plex_url");
  deleteConfig("global_plex_token");
});

describe("shouldRedirect", () => {
  test("fires on an install with nothing configured", () => {
    assert.equal(getOnboardingStatus().shouldRedirect, true);
  });

  test("does not fire for an install that already has a Plex connection", () => {
    // The upgrade case: a working server, and no `onboarding_state` row because
    // the wizard didn't exist when it was set up.
    connectPlex();
    assert.equal(getOnboardingStatus().shouldRedirect, false);
    assert.equal(getOnboardingStatus().shouldShowBanner, true, "still offered, just not forced");
  });

  test("does not fire for an install with rules of its own", () => {
    createRule({ name: "My rule", type: "smart_filter", config: {} });
    assert.equal(getOnboardingStatus().shouldRedirect, false);
  });

  test("is latched off by starting, skipping or dismissing", () => {
    startOnboarding();
    assert.equal(getOnboardingStatus().shouldRedirect, false);

    deleteConfig("onboarding_state");
    skipOnboarding();
    assert.equal(getOnboardingStatus().shouldRedirect, false);

    deleteConfig("onboarding_state");
    dismissOnboarding();
    assert.equal(getOnboardingStatus().shouldRedirect, false);
  });
});

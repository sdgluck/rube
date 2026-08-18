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
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ConfigStoreToken } from "@tinkerbell/core";
import { RulesToken } from "@tinkerbell/domain.rules";
import { OnboardingToken } from "./index.ts";

// This package used to migrate a scratch database by spawning the migrate
// entrypoint by path, because it doesn't depend on `@tinkerbell/db` and the
// connection opened on import. The container does both, in-process.
const c = createTestContainer();
after(() => c.dispose());

const { setConfig, deleteConfig } = c.resolve(ConfigStoreToken);
const { createRule, deleteRule, getRules } = c.resolve(RulesToken);
const { getOnboardingStatus, startOnboarding, dismissOnboarding, skipOnboarding } = c.resolve(OnboardingToken);

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

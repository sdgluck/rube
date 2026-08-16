import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anyNotifierConfigured,
  countableSteps,
  ONBOARDING_STEPS,
  resolveSteps,
  type OnboardingContext,
} from "./steps.ts";

const EMPTY: OnboardingContext = { config: {}, ruleCount: 0, testedRuleCount: 0 };

function ctx(patch: Partial<OnboardingContext>): OnboardingContext {
  return { ...EMPTY, ...patch, config: { ...EMPTY.config, ...patch.config } };
}

function byId(steps: ReturnType<typeof resolveSteps>, id: string) {
  const step = steps.find((s) => s.id === id);
  assert.ok(step, `no step ${id}`);
  return step;
}

test("a fresh install has nothing complete", () => {
  const steps = resolveSteps(EMPTY, []);
  assert.equal(
    steps.every((s) => !s.complete),
    true,
  );
});

test("connect is derived from the same predicate the health page uses", () => {
  const configured = ctx({ config: { global_plex_url: "http://plex.local", global_plex_token: "tk" } });
  assert.equal(byId(resolveSteps(configured, []), "connect").complete, true);
  assert.equal(byId(resolveSteps(configured, []), "connect").derived, true);

  // A URL with no token is not a connection.
  const halfway = ctx({ config: { global_plex_url: "http://plex.local" } });
  assert.equal(byId(resolveSteps(halfway, []), "connect").complete, false);
});

test("acknowledging cannot fake the Plex connection", () => {
  const steps = resolveSteps(EMPTY, ["connect", "notify"]);
  assert.equal(byId(steps, "connect").complete, false);
  assert.equal(byId(steps, "notify").complete, true);
});

test("acknowledging satisfies optional steps, and says it wasn't derived", () => {
  const steps = resolveSteps(EMPTY, ["welcome", "rules", "schedule", "dryrun"]);
  for (const id of ["welcome", "rules", "schedule", "dryrun"]) {
    assert.equal(byId(steps, id).complete, true, id);
    assert.equal(byId(steps, id).derived, false, id);
  }
});

test("real state beats acknowledgement for the derived flag", () => {
  const steps = resolveSteps(ctx({ ruleCount: 3 }), ["rules"]);
  assert.equal(byId(steps, "rules").derived, true);
});

test("rules and dry run count what they actually ask for", () => {
  assert.equal(byId(resolveSteps(ctx({ ruleCount: 1 }), []), "rules").complete, true);
  // Rules exist but none has been dry-run yet.
  assert.equal(byId(resolveSteps(ctx({ ruleCount: 1 }), []), "dryrun").complete, false);
  assert.equal(byId(resolveSteps(ctx({ ruleCount: 1, testedRuleCount: 1 }), []), "dryrun").complete, true);
});

test("any single notification provider satisfies notify", () => {
  assert.equal(anyNotifierConfigured({}), false);
  assert.equal(anyNotifierConfigured({ global_discord_webhook_url: "https://discord/x" }), true);
  assert.equal(
    anyNotifierConfigured({ global_smtp: { host: "smtp.local", port: 587, secure: false, from: "a@b" } }),
    true,
  );
  // Half-configured Telegram is not configured.
  assert.equal(anyNotifierConfigured({ global_telegram_bot_token: "t" }), false);
  // A database key is not a notifier.
  assert.equal(anyNotifierConfigured({ global_tmdb_api_key: "k" }), false);
});

test("un-configuring a service takes its step back to incomplete", () => {
  const connected = ctx({ config: { global_plex_url: "http://plex.local", global_plex_token: "tk" } });
  assert.equal(byId(resolveSteps(connected, []), "connect").complete, true);

  const tokenCleared = ctx({ config: { global_plex_url: "http://plex.local" } });
  assert.equal(byId(resolveSteps(tokenCleared, []), "connect").complete, false);
});

test("connect is the only required step", () => {
  assert.deepEqual(
    ONBOARDING_STEPS.filter((s) => s.required).map((s) => s.id),
    ["connect"],
  );
});

test("the closing summary is not counted towards progress", () => {
  const counted = countableSteps(resolveSteps(EMPTY, []));
  assert.equal(
    counted.some((s) => s.id === "done"),
    false,
  );
  assert.equal(counted.length, ONBOARDING_STEPS.length - 1);
});

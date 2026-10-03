import { type ConfigValue, type ConfigStore } from "@tinkerbell/core";
import { isSeededRule, RECOMMENDED_SCHEDULE_SETTINGS } from "@tinkerbell/contracts";

import {
  countableSteps,
  isOnboardingStepId,
  ONBOARDING_STEPS,
  resolveSteps,
  type OnboardingContext,
  type OnboardingStepId,
  type OnboardingStepStatus,
} from "./steps.ts";
import { type Rules } from "@tinkerbell/domain.rules";
import { type Migration } from "@tinkerbell/domain.migration";
import { token } from "@tinkerbell/container";

export {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  isOnboardingStepId,
  resolveSteps,
  anyNotifierConfigured,
  type OnboardingStepId,
  type OnboardingStep,
  type OnboardingStepStatus,
  type OnboardingContext,
} from "./steps.ts";

export interface OnboardingStatus {
  steps: OnboardingStepStatus[];
  completedCount: number;
  totalCount: number;
  /** Where the wizard should open. */
  lastStepId: OnboardingStepId;
  /** Every required step satisfied. */
  complete: boolean;
  missingRequired: OnboardingStepId[];
  startedAt: number | null;
  skipped: boolean;
  dismissedAt: number | null;
  completedAt: number | null;
  /** Incomplete and not permanently dismissed. */
  shouldShowBanner: boolean;
  /** A never-touched install with no Plex — send them to the wizard once. */
  shouldRedirect: boolean;
}

/**
 * The first step that isn't done yet — where "Resume" should land someone who
 * left the wizard, and the fallback when there's no stored cursor. Falls back
 * to `done` when everything is finished.
 */
function firstIncompleteStep(steps: OnboardingStepStatus[]): OnboardingStepId {
  return countableSteps(steps).find((s) => !s.complete)?.id ?? "done";
}

export interface OnboardingDeps {
  config: ConfigStore;
  rules: Rules;
  migration: Migration;
}
export function createOnboarding(deps: OnboardingDeps) {
  const { getConfig, setConfig, getAllConfig } = deps.config;
  const { getRules } = deps.rules;
  const { getMigrationStatus } = deps.migration;

  function readState() {
    const state = getConfig("onboarding_state");
    return {
      startedAt: state?.startedAt ?? null,
      lastStepId: state?.lastStepId,
      acknowledged: state?.acknowledged ?? [],
      skipped: state?.skipped ?? false,
      dismissedAt: state?.dismissedAt ?? null,
      completedAt: state?.completedAt ?? null,
    };
  }

  function writeState(patch: Partial<ConfigValue<"onboarding_state">>): void {
    const current = getConfig("onboarding_state") ?? { acknowledged: [] };
    setConfig("onboarding_state", { ...current, ...patch });
  }

  function buildContext(): OnboardingContext {
    const rules = getRules();
    const migration = getMigrationStatus();
    // The install seeds one rule at first boot. Counting it would mean the Rules
    // step reports itself done before the user has opened the app.
    const chosen = rules.filter((r) => !isSeededRule(r));
    return {
      config: getAllConfig(),
      ruleCount: chosen.length,
      // Dry-running the seeded rule is a real thing to have done, though, so
      // this counts every rule — including it.
      testedRuleCount: rules.filter((r) => r.lastTestAt != null).length,
      migrationCompleted: migration.providers.some((p) => p.completedAt != null),
      migratableCount: migration.totalCount,
    };
  }

  function getOnboardingStatus(): OnboardingStatus {
    const state = readState();
    const steps = resolveSteps(buildContext(), state.acknowledged);
    const countable = countableSteps(steps);
    const missingRequired = steps.filter((s) => s.required && !s.complete).map((s) => s.id);
    const complete = missingRequired.length === 0 && countable.every((s) => s.complete);

    // A stored cursor that points at a step the user has since completed would
    // strand them on a finished page, so it only wins while it's still unfinished.
    const stored = state.lastStepId;
    const storedUsable =
      stored !== undefined && isOnboardingStepId(stored) && !steps.find((s) => s.id === stored)?.complete;
    const lastStepId = storedUsable ? (stored as OnboardingStepId) : firstIncompleteStep(steps);

    return {
      steps,
      completedCount: countable.filter((s) => s.complete).length,
      totalCount: countable.length,
      lastStepId,
      complete,
      missingRequired,
      startedAt: state.startedAt,
      skipped: state.skipped,
      dismissedAt: state.dismissedAt,
      completedAt: state.completedAt,
      shouldShowBanner: !complete && state.dismissedAt == null,
      // Only ever fires on a truly untouched install.
      //
      // Any of started / skipped / dismissed latches it off for good, which is
      // what stops a redirect loop for someone who has already made a decision
      // about this flow. But absence of that state is not evidence of a new
      // install: an install that predates the wizard has no `onboarding_state`
      // row at all, so upgrading a working server with rules and no notification
      // provider used to redirect its owner into first-run setup.
      //
      // So the install itself has to look untouched too: no Plex connection and no
      // rules of the user's own. Either one means somebody has used this server,
      // and the banner is the right way to offer them the tour.
      shouldRedirect: state.startedAt == null && !state.skipped && state.dismissedAt == null && !complete && looksNew(),
    };
  }

  /**
   * Does this install look like nobody has ever configured it?
   *
   * Deliberately narrow: a Plex URL and token is the one thing Tinkerbell cannot
   * do anything without, and a rule the user chose is proof they got past it. The
   * seeded rule doesn't count, for the same reason it doesn't count towards the
   * Rules step.
   */
  function looksNew(): boolean {
    const config = getAllConfig();
    const plexConnected = !!(config.global_plex_url && config.global_plex_token);
    if (plexConnected) return false;
    return getRules().filter((r) => !isSeededRule(r)).length === 0;
  }

  function startOnboarding(): void {
    if (getConfig("onboarding_state")?.startedAt == null) writeState({ startedAt: Date.now() });
  }

  function setOnboardingStep(stepId: OnboardingStepId): void {
    startOnboarding();
    writeState({ lastStepId: stepId });
  }

  /** Record that the user chose to move past an optional step. */
  function acknowledgeStep(stepId: OnboardingStepId): void {
    const step = ONBOARDING_STEPS.find((s) => s.id === stepId);
    if (!step) throw new Error(`Unknown onboarding step: ${stepId}`);
    if (!step.acknowledgeable) throw new Error(`The "${step.label}" step can't be skipped.`);
    const acknowledged = getConfig("onboarding_state")?.acknowledged ?? [];
    if (acknowledged.includes(stepId)) return;
    startOnboarding();
    writeState({ acknowledged: [...acknowledged, stepId] });
  }

  function skipOnboarding(): void {
    startOnboarding();
    writeState({ skipped: true });
  }

  function dismissOnboarding(): void {
    writeState({ dismissedAt: Date.now() });
  }

  function completeOnboarding(): void {
    writeState({ completedAt: Date.now() });
  }

  /** Back to a clean slate, for someone who wants to walk the flow again. */
  function resetOnboarding(): void {
    setConfig("onboarding_state", { acknowledged: [] });
  }

  /**
   * The recommended scheduling setup, written in one call so the wizard's "Use
   * recommended" button is a single round trip rather than three.
   *
   * The window is the small hours and deferral is on: Tinkerbell's jobs walk the
   * whole library and talk to Plex constantly, and the default a new admin wants
   * is "not while anyone is watching".
   */
  function applyScheduleDefaults(timezone: string): void {
    // The same constant the Recommended preset on Jobs → Schedule applies, so
    // the setup flow can't recommend a window the schedule then ignores.
    const { maintenanceWindow, deferWhileStreaming } = RECOMMENDED_SCHEDULE_SETTINGS;
    setConfig("global_timezone", timezone);
    setConfig("jobs_maintenance_window", { ...maintenanceWindow });
    setConfig("jobs_defer_while_streaming", { ...deferWhileStreaming });
  }

  return {
    getOnboardingStatus,
    startOnboarding,
    setOnboardingStep,
    acknowledgeStep,
    skipOnboarding,
    dismissOnboarding,
    completeOnboarding,
    resetOnboarding,
    applyScheduleDefaults,
  };
}

export type Onboarding = ReturnType<typeof createOnboarding>;

export const OnboardingToken = token<Onboarding>("onboarding");

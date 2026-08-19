import { HEALTH_SERVICES } from "@tinkerbell/domain.health";
import type { configSchema } from "@tinkerbell/core";
import type { z } from "zod";

type ConfigMap = Partial<z.infer<typeof configSchema>>;

export type OnboardingStepId = "welcome" | "connect" | "migrate" | "rules" | "schedule" | "notify" | "dryrun" | "done";

/**
 * What a step's `satisfiedFn` gets to look at. Deliberately a plain value
 * rather than the live database: every predicate in this file is pure, so the
 * step table can be tested against synthetic state without spinning up
 * SQLite. `index.ts` is the only thing that knows how to fill it in.
 */
export interface OnboardingContext {
  config: ConfigMap;
  /**
   * Rules the user chose — imported or written — enabled or not.
   *
   * Excludes the rule `seedDefaultRules` plants at first boot. Counting that
   * one would tick the Rules step on an install nobody has touched yet, which
   * is exactly the false "you're done" this whole design exists to avoid.
   */
  ruleCount: number;
  /**
   * Rules that have been dry-run at all (`rules.lastTestAt`), successfully or
   * not. A failed dry run counts because the step's job is to get someone to
   * *try* one before going live, and a failure is a result worth having seen —
   * gating on success would leave an admin whose only rule errors unable to
   * finish a step that has already told them what they needed to know.
   */
  testedRuleCount: number;
  /**
   * Whether a migration has been completed for any provider.
   *
   * The `migrate` step needs a completion signal that isn't "has rules" —
   * somebody who imported a Kometa config *and* somebody who wrote a rule by
   * hand both have rules, and only one of them has migrated.
   */
  migrationCompleted: boolean;
  /**
   * Collections on the server that look like another tool's output. Non-zero
   * is what makes the migrate step worth showing at all: on a fresh server
   * with an empty library there is nothing to migrate and the step is noise.
   */
  migratableCount: number;
}

/**
 * The notification providers that count towards the `notify` step. Sourced
 * from `HEALTH_SERVICES` so a new provider registered there is picked up here
 * without a second list to keep in step — SMTP is the one exception, because
 * it has no health probe and so no row in that table.
 */
const NOTIFY_HEALTH_SERVICES = new Set([
  "Pushover",
  "Discord",
  "Gotify",
  "LunaSea",
  "Pushbullet",
  "Slack",
  "Telegram",
  "Webhook",
]);

function healthConfigured(config: ConfigMap, service: string): boolean {
  const entry = HEALTH_SERVICES.find((s) => s.service === service);
  return entry ? entry.configuredFn(config) : false;
}

export function anyNotifierConfigured(config: ConfigMap): boolean {
  const viaHealth = HEALTH_SERVICES.some((s) => NOTIFY_HEALTH_SERVICES.has(s.service) && s.configuredFn(config));
  return viaHealth || !!config.global_smtp?.host;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  /**
   * Required steps gate the wizard's Next button and decide whether setup
   * counts as complete. Plex is the only one — everything else Tinkerbell can
   * run without, and pretending otherwise would make the flow a wall rather
   * than a guide.
   */
  required: boolean;
  /**
   * Whether the step can be satisfied by pressing past it. False for
   * `connect`, so acknowledging can never fake a Plex connection that isn't
   * there; true elsewhere, because "I don't want notifications" is a real
   * answer and the flow has to accept it.
   */
  acknowledgeable: boolean;
  /**
   * Derives completion from real state. `null` means the step has nothing to
   * derive from and is satisfied by acknowledgement alone (the concepts tour,
   * and the closing summary).
   */
  satisfiedFn: ((ctx: OnboardingContext) => boolean) | null;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: "welcome", label: "Welcome", required: false, acknowledgeable: true, satisfiedFn: null },
  {
    id: "connect",
    label: "Connect",
    required: true,
    acknowledgeable: false,
    satisfiedFn: (ctx) => healthConfigured(ctx.config, "Plex"),
  },
  {
    id: "migrate",
    label: "Migrate",
    required: false,
    acknowledgeable: true,
    /**
     * Satisfied by having migrated, or by there being nothing to migrate.
     *
     * The second half matters more than the first: most installs are not
     * coming from anywhere, and a step that sits permanently incomplete for
     * them turns the progress count into a lie.
     */
    satisfiedFn: (ctx) => ctx.migrationCompleted || ctx.migratableCount === 0,
  },
  {
    id: "rules",
    label: "Rules",
    required: false,
    acknowledgeable: true,
    satisfiedFn: (ctx) => ctx.ruleCount > 0,
  },
  {
    id: "schedule",
    label: "Schedule",
    required: false,
    acknowledgeable: true,
    satisfiedFn: (ctx) => !!ctx.config.global_timezone,
  },
  {
    id: "notify",
    label: "Notifications",
    required: false,
    acknowledgeable: true,
    satisfiedFn: (ctx) => anyNotifierConfigured(ctx.config),
  },
  {
    id: "dryrun",
    label: "Dry run",
    required: false,
    acknowledgeable: true,
    satisfiedFn: (ctx) => ctx.testedRuleCount > 0,
  },
  { id: "done", label: "Done", required: false, acknowledgeable: true, satisfiedFn: null },
];

export const ONBOARDING_STEP_IDS: OnboardingStepId[] = ONBOARDING_STEPS.map((s) => s.id);

export function isOnboardingStepId(value: string): value is OnboardingStepId {
  return ONBOARDING_STEP_IDS.includes(value as OnboardingStepId);
}

export interface OnboardingStepStatus {
  id: OnboardingStepId;
  label: string;
  required: boolean;
  complete: boolean;
  /** True when completion came from real state rather than a click. */
  derived: boolean;
}

/**
 * Resolve every step against real state plus the user's acknowledgements.
 *
 * A step is complete when its `satisfiedFn` says so, or when the user
 * explicitly moved past it and the step allows that. Derived-first is the
 * point of the whole design: a `connect` step that was green yesterday goes
 * back to red the moment the Plex token is cleared, rather than sitting on a
 * stored boolean that says setup finished.
 */
export function resolveSteps(ctx: OnboardingContext, acknowledged: readonly string[]): OnboardingStepStatus[] {
  const ack = new Set(acknowledged);
  return ONBOARDING_STEPS.map((step) => {
    const derived = step.satisfiedFn?.(ctx) ?? false;
    const complete = derived || (step.acknowledgeable && ack.has(step.id));
    return { id: step.id, label: step.label, required: step.required, complete, derived };
  });
}

/**
 * `done` is a summary, not a task — counting it would mean the progress bar
 * could never read full while the user is still looking at it.
 */
export function countableSteps(steps: OnboardingStepStatus[]): OnboardingStepStatus[] {
  return steps.filter((s) => s.id !== "done");
}

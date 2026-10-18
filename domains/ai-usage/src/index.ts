/* ─── What the LLM has cost, and whether it may cost more ───────────────────
 *
 * Every LLM request in the app goes through `track()`, which wraps an
 * `LlmClient` so the caller's code is unchanged: it builds a client, wraps it,
 * and calls `complete` as before. The wrapper writes one `llm_usage` row per
 * request — success or failure — and refuses a metered request once the
 * month's token budget is spent.
 *
 * Tokens only, no money. Prices differ per provider and per model, change
 * without notice, and don't exist at all for Ollama or a self-hosted
 * OpenAI-compatible endpoint; a built-in price table would be wrong within a
 * quarter and a wrong figure is worse than none.
 *
 * Diagnostic calls (health check, Test connection) are recorded but never
 * refused. A budget that also blocked the button that tells you whether the
 * provider works would leave nothing to debug a spent month with.
 */

import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { llmUsage, rules, type Db } from "@tinkerbell/db";
import { token } from "@tinkerbell/container";
import { DAY_MS, errorMessage, startOfLocalMonth, type ConfigStore } from "@tinkerbell/core";
import type { LlmClient, LlmRequest, LlmResponse } from "@tinkerbell/llm";
import type { Clock } from "@tinkerbell/ports";

export const LLM_FEATURES = [
  "rule",
  "rule-preview",
  // The wizard's "Describe it": one short call per draft, while the admin waits.
  "rule-draft",
  "because-you-watched",
  // Settings → AI "Try it". Its own line so an evening of experiments isn't
  // read as the nightly job getting more expensive.
  "because-you-watched-preview",
  "we-think-youd-like",
  "collection-summary",
  "health-check",
  "test-connection",
] as const;
export type LlmFeature = (typeof LLM_FEATURES)[number];

/** Recorded, counted toward the budget, but never refused by it. */
const DIAGNOSTIC_FEATURES: ReadonlySet<LlmFeature> = new Set(["health-check", "test-connection"]);

/**
 * Thirteen months: enough to compare this month against the same month last
 * year, which is the question a usage history gets asked. A row is ~100 bytes.
 */
export const LLM_USAGE_RETENTION_MS = 400 * DAY_MS;

export class LlmBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmBudgetExceededError";
  }
}

export interface TrackOptions {
  feature: LlmFeature;
  ruleId?: string;
}

export interface UsageTotals {
  calls: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
}

export interface BudgetStatus {
  /** Tokens (in + out) since the start of this calendar month. */
  used: number;
  /** null when no budget is set. */
  budget: number | null;
  exceeded: boolean;
  monthStart: number;
}

export interface AiUsageDeps {
  db: Db;
  config: ConfigStore;
  now: Clock;
}

export function createAiUsage(deps: AiUsageDeps) {
  const { db, config, now } = deps;

  function record(entry: {
    feature: LlmFeature;
    ruleId?: string;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    ok: boolean;
    error?: string;
    durationMs: number;
  }): void {
    db.insert(llmUsage)
      .values({
        at: now(),
        feature: entry.feature,
        ruleId: entry.ruleId ?? null,
        provider: entry.provider,
        model: entry.model,
        tokensIn: entry.tokensIn,
        tokensOut: entry.tokensOut,
        ok: entry.ok,
        error: entry.error ?? null,
        durationMs: entry.durationMs,
      })
      .run();
  }

  function totalsSince(since: number): UsageTotals {
    const row = db
      .select({
        calls: sql<number>`count(*)`,
        failed: sql<number>`coalesce(sum(case when ${llmUsage.ok} = 0 then 1 else 0 end), 0)`,
        tokensIn: sql<number>`coalesce(sum(${llmUsage.tokensIn}), 0)`,
        tokensOut: sql<number>`coalesce(sum(${llmUsage.tokensOut}), 0)`,
      })
      .from(llmUsage)
      .where(gte(llmUsage.at, since))
      .get();
    return row ?? { calls: 0, failed: 0, tokensIn: 0, tokensOut: 0 };
  }

  function budgetStatus(): BudgetStatus {
    const monthStart = startOfLocalMonth(now(), config.configuredTimezone());
    const totals = totalsSince(monthStart);
    const used = totals.tokensIn + totals.tokensOut;
    // 0 is "no cap" rather than "nothing allowed": a cap of zero tokens is
    // what clearing the field means, and an empty number input saves as 0.
    const configured = config.getConfig("ai_monthly_token_budget");
    const budget = configured && configured > 0 ? configured : null;
    return { used, budget, exceeded: budget !== null && used >= budget, monthStart };
  }

  /** Why metered AI work must not run right now, or null. Shaped like the other `*UnavailableReason`s. */
  function budgetExceededReason(): string | null {
    const status = budgetStatus();
    if (!status.exceeded) return null;
    return `the monthly AI token budget is spent (${status.used.toLocaleString("en-GB")} of ${status.budget!.toLocaleString("en-GB")}; Settings → AI)`;
  }

  /**
   * Wrap a client so every request is recorded and metered ones respect the
   * budget. The check happens per request, not per job: a batch of AI rules
   * that crosses the cap stops at the rule that crossed it.
   *
   * The check is before the call, so one request can overshoot the cap by its
   * own size. Refusing on a projected cost would need the response length up
   * front, which nobody has.
   */
  function track(client: LlmClient, opts: TrackOptions): LlmClient {
    async function call(run: () => Promise<LlmResponse>): Promise<LlmResponse> {
      if (!DIAGNOSTIC_FEATURES.has(opts.feature)) {
        const reason = budgetExceededReason();
        if (reason) throw new LlmBudgetExceededError(`Skipped: ${reason}`);
      }
      const started = performance.now();
      try {
        const res = await run();
        record({
          ...opts,
          provider: res.provider,
          model: res.model,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          ok: true,
          durationMs: Math.round(performance.now() - started),
        });
        return res;
      } catch (err) {
        record({
          ...opts,
          provider: client.provider,
          model: client.model,
          tokensIn: 0,
          tokensOut: 0,
          ok: false,
          error: errorMessage(err).slice(0, 500),
          durationMs: Math.round(performance.now() - started),
        });
        throw err;
      }
    }
    return {
      provider: client.provider,
      model: client.model,
      complete: (req: LlmRequest) => call(() => client.complete(req)),
      ping: (signal?: AbortSignal) => call(() => client.ping(signal)),
      // Not a call to the model — nothing to budget or record.
      ...(client.promptBudget ? { promptBudget: client.promptBudget.bind(client) } : {}),
    };
  }

  /** What Settings → AI shows: windows, the budget, and the last 30 days broken down. */
  function usageSummary() {
    const t = now();
    const since30 = t - 30 * DAY_MS;
    const tokens = sql<number>`coalesce(sum(${llmUsage.tokensIn} + ${llmUsage.tokensOut}), 0)`;
    const breakdownCols = {
      calls: sql<number>`count(*)`,
      failed: sql<number>`coalesce(sum(case when ${llmUsage.ok} = 0 then 1 else 0 end), 0)`,
      tokensIn: sql<number>`coalesce(sum(${llmUsage.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${llmUsage.tokensOut}), 0)`,
    };

    const byFeature = db
      .select({ feature: llmUsage.feature, ...breakdownCols })
      .from(llmUsage)
      .where(gte(llmUsage.at, since30))
      .groupBy(llmUsage.feature)
      .orderBy(desc(tokens))
      .all();

    const byModel = db
      .select({ provider: llmUsage.provider, model: llmUsage.model, ...breakdownCols })
      .from(llmUsage)
      .where(gte(llmUsage.at, since30))
      .groupBy(llmUsage.provider, llmUsage.model)
      .orderBy(desc(tokens))
      .all();

    // Left join: a deleted rule's usage still shows, just without a name.
    const byRule = db
      .select({ ruleId: llmUsage.ruleId, ruleName: rules.name, ...breakdownCols })
      .from(llmUsage)
      .leftJoin(rules, eq(rules.id, llmUsage.ruleId))
      .where(and(gte(llmUsage.at, since30), isNotNull(llmUsage.ruleId)))
      .groupBy(llmUsage.ruleId)
      .orderBy(desc(tokens))
      .limit(10)
      .all();

    return {
      day: totalsSince(t - DAY_MS),
      week: totalsSince(t - 7 * DAY_MS),
      month: totalsSince(since30),
      budget: budgetStatus(),
      byFeature,
      byModel,
      byRule,
    };
  }

  /** Drop rows past retention. Called by `purge-runs`. */
  function pruneLlmUsage(): number {
    return db
      .delete(llmUsage)
      .where(lt(llmUsage.at, now() - LLM_USAGE_RETENTION_MS))
      .run().changes;
  }

  return { record, track, budgetStatus, budgetExceededReason, usageSummary, pruneLlmUsage };
}

export type AiUsage = ReturnType<typeof createAiUsage>;
export type AiUsageSummary = ReturnType<AiUsage["usageSummary"]>;
export const AiUsageToken = token<AiUsage>("aiUsage");

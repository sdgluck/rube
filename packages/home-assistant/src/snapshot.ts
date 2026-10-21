/**
 * The state Home Assistant gets, read through the tRPC caller.
 *
 * Through the caller rather than the domains for the agent API's reason: it
 * answers what the UI would, so "Failing rules: 3" in HA and the Rules page
 * can't disagree about what failing means. Each source is settled on its own —
 * Plex being down must not stop HA hearing that Plex is down.
 */

import type { createTrpc } from "@rube/trpc";
import type { Snapshot } from "./entities.ts";

type Caller = ReturnType<ReturnType<typeof createTrpc>["createCaller"]>;

async function settle<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function takeSnapshot(caller: Caller, version: string): Promise<Snapshot> {
  const [sessions, health, rules, jobs, ruleRuns, metrics, library] = await Promise.all([
    settle(() => caller.stats.sessions()),
    settle(() => caller.health.status()),
    settle(() => caller.rules.list()),
    settle(() => caller.jobs.activeRuns()),
    settle(() => caller.rules.activeRuns()),
    settle(() => caller.nav.metrics()),
    settle(() => caller.stats.overview()),
  ]);

  const live = (sessions ?? []).map((s) => ({
    user: s.user,
    title: s.grandparentTitle ? `${s.grandparentTitle} — ${s.title}` : s.year ? `${s.title} (${s.year})` : s.title,
    state: s.state,
    decision: s.decision,
    player: s.player,
  }));
  const failing = (rules ?? []).filter((r) => r.enabled && r.lastRunStatus === "error").map((r) => r.name);
  // A muted service is one the admin has said not to shout about; HA is
  // another place to shout.
  const down = (health ?? [])
    .filter((h) => h.configured && h.status === "error" && !h.mutedUntil)
    .map((h) => h.service);
  const running = [...(jobs ?? []).map((j) => j.jobName), ...(ruleRuns ?? []).map((r) => r.ruleName)];

  return {
    version,
    streams: live.length,
    transcodes: (sessions ?? []).filter((s) => s.decision === "transcode").length,
    bandwidth: (sessions ?? []).reduce((sum, s) => sum + (s.bandwidth ?? 0), 0),
    now_playing:
      live.length === 0
        ? "Nothing"
        : live.length === 1
          ? `${live[0].user} — ${live[0].title}`
          : `${live.length} streams`,
    current_job: running[0] ?? "Idle",
    busy: running.length > 0,
    rules_failing: failing.length,
    problems: metrics?.problems ?? 0,
    cleanup_due: metrics?.cleanupDueSoon ?? 0,
    services_down: down.length,
    movies: library?.movieCount ?? 0,
    shows: library?.showCount ?? 0,
    added_this_week: library?.addedThisWeek ?? 0,
    attrs: { sessions: live, jobs: running, failing_rules: failing, services_down: down },
  };
}

/**
 * The agent API's tools — the one list both `/mcp` and `/api/v1` serve.
 *
 * Curated rather than generated from the tRPC router. The router has ~300
 * procedures shaped for screens: `rules.list` ships every rule's full config
 * because the table needs it, `jobs.runLog` pages a log by byte offset because
 * the UI tails it live. An agent handed all of that spends its context on
 * fields nobody asked about and picks between six near-identical procedures by
 * name. So each tool here answers a question someone would actually ask — "why
 * is this film in that collection", "what failed last night" — and composes
 * the queries that answer it.
 *
 * Every tool goes through the tRPC caller, never a domain directly. That keeps
 * a tool's answer identical to what the admin UI shows, and puts each call
 * under `refuseWritesFromAgents` in `_base.ts`: a tool that reached for a
 * mutation would fail on its first call rather than ship. `tools.test.ts` calls
 * every tool to prove none does.
 *
 * Descriptions are written for the model reading them, not for a human
 * skimming a list: they say when to use the tool and what the ids in its input
 * are and where to get them.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { narrateSmartFilter, ruleConfigSchema } from "@tinkerbell/contracts";
import { CHANGE_KINDS } from "@tinkerbell/domain.changes";
import { SEARCH_KINDS } from "@tinkerbell/domain.search";
import type { Trpc } from "@tinkerbell/trpc";

export type AppCaller = ReturnType<Trpc["createCaller"]>;

export interface ToolContext {
  caller: AppCaller;
  /** This build's version, for the overview. */
  version: string;
}

export interface AgentTool {
  /** snake_case, stable: it is the MCP tool name and the REST path segment. */
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  run(input: never, ctx: ToolContext): Promise<unknown>;
}

function defineTool<S extends z.ZodObject>(tool: {
  name: string;
  title: string;
  description: string;
  input: S;
  run(input: z.output<S>, ctx: ToolContext): unknown;
}): AgentTool {
  return { ...tool, run: async (input, ctx) => tool.run(input as z.output<S>, ctx) } as AgentTool;
}

const DEFAULT_LOG_TAIL = 8_000;
const logTailChars = z
  .number()
  .int()
  .min(0)
  .max(200_000)
  .default(DEFAULT_LOG_TAIL)
  .describe("How many characters from the end of the run's log to include. 0 for none.");

const ruleId = z.string().min(1).describe("A rule id, from list_rules or search.");
const ratingKey = z.string().min(1).describe("A Plex rating key, from search, search_media or a collection's items.");
const offset = z.number().int().min(0).default(0);
const periodDays = z
  .union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)])
  .default(7)
  .describe("Window in days: 7, 30 or 90. 0 means all recorded history.");

/**
 * Run some reads side by side, and keep going when one fails.
 *
 * The overview reads a dozen things, and an instance with Plex unreachable is
 * precisely the one somebody asks an agent about. A failed part becomes an
 * `{ error }` in its place rather than failing the whole answer.
 */
async function settle<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The end of a log, which is where a failure says what went wrong. */
async function logTail(
  read: (offset: number) => Promise<{ chunk: string; size: number }>,
  chars: number,
): Promise<{ text: string; totalChars: number; truncated: boolean } | null> {
  if (chars === 0) return null;
  // An offset past the end returns no text and the size, so the second read
  // can fetch exactly the tail rather than the whole log.
  const { size } = await read(Number.MAX_SAFE_INTEGER);
  const from = Math.max(0, size - chars);
  const { chunk } = await read(from);
  return { text: chunk, totalChars: size, truncated: from > 0 };
}

/**
 * `rules.get` and `collections.get` throw a plain `Error` for a missing row,
 * which tRPC reports as a 500. Both are local reads whose only failure is
 * absence, so a tool can say 404 and mean it — a model told "server error"
 * retries, one told "not found" goes and looks the id up.
 */
function notFound(what: string): (err: unknown) => never {
  return () => {
    throw new TRPCError({ code: "NOT_FOUND", message: `No ${what}.` });
  };
}

function cap<T>(items: T[], limit: number): { items: T[]; total: number; truncated: boolean } {
  return { items: items.slice(0, limit), total: items.length, truncated: items.length > limit };
}

/** A rule's config, told in a sentence where it can be. */
function criteriaOf(config: unknown): string | null {
  const parsed = ruleConfigSchema.safeParse(config);
  const filter = parsed.success ? parsed.data.smartFilter : undefined;
  return filter && filter.children.length > 0 ? narrateSmartFilter(filter, { noun: "items" }) : null;
}

export const TOOLS: AgentTool[] = [
  defineTool({
    name: "get_overview",
    title: "Instance overview",
    description:
      "Start here. A one-call summary of this Tinkerbell instance: version, service health, rule counts and " +
      "which rules last failed, what is running now, scheduled starts being held back, the most recent job " +
      "failure, and library totals. Use the more specific tools to drill into anything it mentions.",
    input: z.object({}),
    async run(_input, { caller, version }) {
      const [health, rules, activeJobs, activeRules, lastFailure, deferred, library] = await Promise.all([
        settle(() => caller.health.status()),
        settle(() => caller.rules.list()),
        settle(() => caller.jobs.activeRuns()),
        settle(() => caller.rules.activeRuns()),
        settle(() => caller.jobs.lastFailure()),
        settle(() => caller.jobs.deferred()),
        settle(() => caller.stats.overview()),
      ]);

      return {
        version,
        health: Array.isArray(health)
          ? health
              .filter((h) => h.configured)
              .map((h) => ({ service: h.service, status: h.status, message: h.message, at: h.timestamp }))
          : health,
        rules: Array.isArray(rules)
          ? {
              total: rules.length,
              enabled: rules.filter((r) => r.enabled).length,
              byType: Object.fromEntries(
                [...new Set(rules.map((r) => r.type))].map((type) => [
                  type,
                  rules.filter((r) => r.type === type).length,
                ]),
              ),
              lastRunFailed: rules
                .filter((r) => r.enabled && r.lastRunStatus === "error")
                .map((r) => ({ id: r.id, name: r.name, error: r.lastRunError, at: r.lastRunAt })),
            }
          : rules,
        runningNow: { jobs: activeJobs, rules: activeRules },
        deferredStarts: deferred,
        lastJobFailure: lastFailure,
        library,
      };
    },
  }),

  defineTool({
    name: "get_health",
    title: "Service health",
    description:
      "Connection health of every integration (Plex, Radarr, Sonarr, Seerr, TMDb, OMDb, LLM, notifications…): " +
      "whether it is configured, its latest status and message, and any mute. Set historyHours to also get " +
      "each service's status changes over that window.",
    input: z.object({
      historyHours: z.number().int().min(1).max(720).optional().describe("Include status history for this many hours."),
    }),
    async run({ historyHours }, { caller }) {
      const status = await caller.health.status();
      if (!historyHours) return { status };
      return { status, history: await caller.health.history({ hours: historyHours }) };
    },
  }),

  defineTool({
    name: "list_rules",
    title: "List rules",
    description:
      "Every rule, in running order, with its type, whether it is enabled, the libraries it reads, its " +
      "schedule, and the outcome of its last run. A rule turns a selection of library items into an action: " +
      "a collection, playlist, label, overlay, metadata change or cleanup. Use get_rule for one rule's full " +
      "configuration.",
    input: z.object({
      search: z.string().optional().describe("Case-insensitive substring of the rule name."),
      type: z.string().optional().describe("Only rules of this type, e.g. smart_filter."),
      enabled: z.boolean().optional(),
    }),
    async run({ search, type, enabled }, { caller }) {
      const needle = search?.toLowerCase();
      return (await caller.rules.list())
        .filter((r) => (needle ? r.name.toLowerCase().includes(needle) : true))
        .filter((r) => (type ? r.type === type : true))
        .filter((r) => (enabled === undefined ? true : !!r.enabled === enabled))
        .map((r) => {
          const config = r.config as { sections?: string[]; schedule?: unknown; collectionName?: string };
          return {
            id: r.id,
            name: r.name,
            type: r.type,
            enabled: !!r.enabled,
            sections: config.sections ?? [],
            collectionName: config.collectionName ?? null,
            schedule: config.schedule ?? null,
            runCount: r.runCount,
            lastRun: r.lastRunAt
              ? {
                  at: r.lastRunAt,
                  status: r.lastRunStatus,
                  error: r.lastRunError,
                  durationMs: r.lastRunDurationMs,
                  collections: r.lastRunCollectionCount,
                  items: r.lastRunItemCount,
                  runId: r.lastRunId,
                }
              : null,
          };
        });
    },
  }),

  defineTool({
    name: "get_rule",
    title: "Get a rule",
    description:
      "One rule in full: its configuration, a plain-English statement of its smart-filter criteria where it " +
      "has one, its five most recent runs with how many items each added and removed, and its cleanup " +
      "queue tallies if it is a cleanup rule.",
    input: z.object({ ruleId }),
    async run({ ruleId }, { caller }) {
      const [rule, runs, cleanupCounts] = await Promise.all([
        caller.rules.get({ id: ruleId }).catch(notFound(`rule ${ruleId}`)),
        caller.rules.runs({ ruleId, limit: 5 }),
        settle(() => caller.cleanup.counts()),
      ]);
      return {
        ...rule,
        enabled: !!rule.enabled,
        criteria: criteriaOf(rule.config),
        recentRuns: runs,
        cleanup: "error" in cleanupCounts ? null : ((cleanupCounts as Record<string, unknown>)[ruleId] ?? null),
      };
    },
  }),

  defineTool({
    name: "list_rule_runs",
    title: "List rule runs",
    description:
      "Recent runs of one rule (with ruleId) or of every rule (without), newest first: status, trigger, " +
      "item and collection counts, error. phase 'test' runs are dry runs that changed nothing. Use " +
      "get_rule_run for one run's log and changes.",
    input: z.object({
      ruleId: ruleId.optional(),
      phase: z.enum(["run", "test"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    async run({ ruleId, phase, limit }, { caller }) {
      if (ruleId) return caller.rules.runs({ ruleId, phase, limit });
      const runs = await caller.rules.recentRuns({ limit });
      return phase ? runs.filter((r) => r.phase === phase) : runs;
    },
  }),

  defineTool({
    name: "get_rule_run",
    title: "Get a rule run",
    description:
      "One rule run: its status and counts, what it added to and removed from each collection, where the " +
      "items went if it produced none (the filter funnel), and the end of its log. The first place to look " +
      "when a rule did something unexpected.",
    input: z.object({
      runId: z.string().min(1).describe("A rule run id, from list_rule_runs or get_rule."),
      logTailChars,
      maxItemsPerCollection: z.number().int().min(0).max(500).default(50),
    }),
    async run({ runId, logTailChars, maxItemsPerCollection }, { caller }) {
      const run = await caller.rules.runDetail({ runId });
      if (!run) notFound(`rule run ${runId}`)(null);
      const [changes, funnel, log] = await Promise.all([
        caller.rules.runChanges({ runId }),
        caller.rules.runFunnel({ runId }),
        logTail((o) => caller.rules.runLog({ runId, offset: o }), logTailChars),
      ]);
      return {
        run,
        changes: changes.map((group) => ({
          ...group,
          added: cap(group.added, maxItemsPerCollection),
          removed: cap(group.removed, maxItemsPerCollection),
        })),
        funnel: funnel.funnel,
        log,
      };
    },
  }),

  defineTool({
    name: "explain_item_for_rule",
    title: "Explain an item against a rule",
    description:
      "Why one library item does or does not match one smart-filter rule, clause by clause with the item's " +
      "actual values. Use it for 'why isn't X in this collection?'. Other rule types select from a source " +
      "list and have no clauses; the answer says so.",
    input: z.object({ ruleId, ratingKey }),
    run: ({ ruleId, ratingKey }, { caller }) => caller.rules.explainItem({ ruleId, ratingKey }),
  }),

  defineTool({
    name: "find_rule_conflicts",
    title: "Find rule conflicts",
    description:
      "Places where rules disagree — two rules building the same collection, a cleanup rule queueing an " +
      "item another rule keeps, and so on — most consequential first.",
    input: z.object({}),
    run: (_input, { caller }) => caller.rules.conflicts(),
  }),

  defineTool({
    name: "list_jobs",
    title: "List jobs",
    description:
      "Every scheduled job (generate, cleanup, metadata, media sync, backups, digests…) with its cron " +
      "schedule and whether it is enabled, plus what is running right now and which scheduled starts are " +
      "being held back (for example while someone is streaming).",
    input: z.object({}),
    async run(_input, { caller }) {
      const [jobs, running, deferred, timezone] = await Promise.all([
        caller.jobs.list(),
        caller.jobs.activeRuns(),
        caller.jobs.deferred(),
        caller.config.effectiveTimezone(),
      ]);
      return { timezone: timezone.timezone, jobs, running, deferred };
    },
  }),

  defineTool({
    name: "list_job_runs",
    title: "List job runs",
    description:
      "Recent runs of one job (with jobId, from list_jobs) or of all jobs (without), newest first, with " +
      "status, progress message and timings. Use get_job_run for a run's log.",
    input: z.object({
      jobId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    run: ({ jobId, limit }, { caller }) =>
      jobId ? caller.jobs.runs({ jobId, limit }) : caller.jobs.recentRuns({ limit }),
  }),

  defineTool({
    name: "get_job_run",
    title: "Get a job run",
    description:
      "One job run: status, failure kind, timings, the end of its log, and — for generate and cleanup runs — " +
      "the per-rule breakdown of what each rule did within it.",
    input: z.object({
      runId: z.string().min(1).describe("A job run id, from list_job_runs or get_overview."),
      logTailChars,
    }),
    async run({ runId, logTailChars }, { caller }) {
      const [run, log, rules] = await Promise.all([
        caller.jobs.run({ runId }),
        logTail((o) => caller.jobs.runLog({ runId, offset: o }), logTailChars),
        caller.rules.runsForJobRun({ jobRunId: runId }),
      ]);
      return { run, ruleRuns: rules, log };
    },
  }),

  defineTool({
    name: "search",
    title: "Search everything",
    description:
      "Find rules, collections, media, jobs, Plex users and libraries, overlay presets, prerolls and events " +
      "by name in one call. The quickest way to " +
      "turn a name someone mentions into the id or rating key the other tools take.",
    input: z.object({
      query: z.string().min(1),
      kinds: z.array(z.enum(SEARCH_KINDS)).optional().describe("Only these kinds of result."),
      limit: z.number().int().min(1).max(20).default(10).describe("Per kind."),
    }),
    run: (input, { caller }) => caller.search.global(input),
  }),

  defineTool({
    name: "list_library_sections",
    title: "List library sections",
    description:
      "The Plex libraries (sections) with their ids and types. Section ids filter the media and collection tools.",
    input: z.object({}),
    run: (_input, { caller }) => caller.plexSections(),
  }),

  defineTool({
    name: "list_collections",
    title: "List collections",
    description:
      "Plex collections from Tinkerbell's local index, with item counts and labels. A label of the form " +
      "`Rule:<id>` names the rule that builds the collection. Filter by section, rule or label, or search by title.",
    input: z.object({
      search: z.string().optional(),
      sectionIds: z.array(z.string()).optional(),
      ruleIds: z.array(z.string()).optional().describe("Only collections built by these rules."),
      labels: z.array(z.string()).optional(),
      sort: z.string().optional(),
      sortDir: z.enum(["asc", "desc"]).optional(),
      offset,
      limit: z.number().int().min(1).max(200).default(50),
    }),
    run: (input, { caller }) => caller.collections.list(input),
  }),

  defineTool({
    name: "get_collection",
    title: "Get a collection",
    description:
      "One collection: its record, the rule that owns it (if any), and its items as Plex currently has them.",
    input: z.object({
      ratingKey: z.string().min(1).describe("The collection's rating key, from list_collections or search."),
      itemLimit: z.number().int().min(0).max(1000).default(100),
    }),
    async run({ ratingKey, itemLimit }, { caller }) {
      const [collection, owningRule, items] = await Promise.all([
        caller.collections.get({ ratingKey }).catch(notFound(`collection ${ratingKey}`)),
        settle(() => caller.collections.owningRule({ ratingKey })),
        itemLimit > 0 ? settle(() => caller.collections.items({ ratingKey })) : Promise.resolve(null),
      ]);
      return {
        collection,
        owningRule,
        items: Array.isArray(items)
          ? cap(
              items.map((i) => ({ ratingKey: i.ratingKey, title: i.title, year: i.year })),
              itemLimit,
            )
          : items,
      };
    },
  }),

  defineTool({
    name: "search_media",
    title: "Search media",
    description:
      "Movies, shows and other items from the local media index, with technical details (resolution, codecs, " +
      "size) and labels. Filter by section, type or label, or search by title.",
    input: z.object({
      search: z.string().optional(),
      sectionIds: z.array(z.string()).optional(),
      types: z.array(z.string()).optional().describe("Plex item types, e.g. movie, show."),
      labels: z.array(z.string()).optional(),
      sort: z.string().optional(),
      sortDir: z.enum(["asc", "desc"]).optional(),
      offset,
      limit: z.number().int().min(1).max(200).default(50),
    }),
    run: (input, { caller }) => caller.media.list(input),
  }),

  defineTool({
    name: "get_media_item",
    title: "Get a media item",
    description:
      "One library item from Plex in detail, plus every collection it is in and, for each, the rule behind " +
      "that collection and that rule's criteria in plain English. Answers 'why is this in that collection?'.",
    input: z.object({ ratingKey }),
    async run({ ratingKey }, { caller }) {
      const [item, why] = await Promise.all([caller.media.get({ ratingKey }), caller.media.why({ ratingKey })]);
      return { item, inCollectionsBecause: why };
    },
  }),

  defineTool({
    name: "get_cleanup_queue",
    title: "Cleanup queue",
    description:
      "Everything cleanup rules have queued for deletion or unmonitoring, closest to being actioned first, " +
      "with each item's streak and due date; plus standing protections and how much of the daily cap the " +
      "last 24 hours used.",
    input: z.object({
      includeActioned: z.boolean().default(false).describe("Also include items already actioned."),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    async run({ includeActioned, limit }, { caller }) {
      const [queue, protections, capUsage] = await Promise.all([
        caller.cleanup.queue({ includeActioned }),
        caller.cleanup.protections(),
        caller.cleanup.capUsage(),
      ]);
      return { queue: cap(queue, limit), protections, actionedInLastDay: capUsage.used };
    },
  }),

  defineTool({
    name: "list_events",
    title: "List events",
    description:
      "The event log: sign-ins, job failures, health changes, cleanup actions, new media, notifications and " +
      "more, newest first. Filter by event type or search the message.",
    input: z.object({
      types: z.array(z.string()).optional().describe("Event types, e.g. job.failed. Omit for all."),
      search: z.string().optional(),
      offset,
      limit: z.number().int().min(1).max(200).default(50),
    }),
    run: (input, { caller }) => caller.events.list(input),
  }),

  defineTool({
    name: "list_changes",
    title: "List library changes",
    description:
      "What Tinkerbell has done to the Plex library, newest first: items added to and removed from " +
      "collections, metadata written, cleanup actions, rule edits and overlays applied.",
    input: z.object({
      kinds: z.array(z.enum(CHANGE_KINDS)).optional(),
      sinceHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 365)
        .optional()
        .describe("Only changes in the last N hours."),
      limit: z.number().int().min(1).max(500).default(100),
    }),
    run: ({ kinds, sinceHours, limit }, { caller }) =>
      caller.changes.feed({ kinds, limit, since: sinceHours ? Date.now() - sinceHours * 3_600_000 : undefined }),
  }),

  defineTool({
    name: "get_config",
    title: "Get configuration",
    description:
      "The instance's settings, with every secret shown as a redaction marker. Large; pass keyPrefix to " +
      "narrow it (e.g. 'cleanup_', 'global_', 'portal_').",
    input: z.object({ keyPrefix: z.string().optional() }),
    async run({ keyPrefix }, { caller }) {
      const [config, timezone] = await Promise.all([caller.config.get(), caller.config.effectiveTimezone()]);
      const entries = Object.entries(config).filter(([key]) => (keyPrefix ? key.startsWith(keyPrefix) : true));
      return { effectiveTimezone: timezone, settings: Object.fromEntries(entries) };
    },
  }),

  defineTool({
    name: "get_watch_stats",
    title: "Watch statistics",
    description:
      "Playback statistics for a period: activity summary, most-watched titles, top users, and the split of " +
      "devices, apps and transcode decisions.",
    input: z.object({
      periodDays,
      rank: z.enum(["plays", "viewers"]).default("plays").describe("Rank most-watched by plays or distinct viewers."),
    }),
    async run({ periodDays, rank }, { caller }) {
      const [activity, mostWatched, topUsers, breakdown, coverage] = await Promise.all([
        caller.stats.activity(),
        caller.stats.mostWatched({ periodDays, rank }),
        caller.stats.topUsers({ periodDays }),
        caller.stats.playbackBreakdown({ periodDays }),
        caller.stats.watchHistoryCoverage(),
      ]);
      return { periodDays, activity, mostWatched, topUsers, breakdown, historyCoverage: coverage };
    },
  }),

  defineTool({
    name: "get_playback_history",
    title: "Playback history",
    description:
      "Individual plays, newest first, optionally for one user (userId from list_users) or one item (ratingKey).",
    input: z.object({
      periodDays,
      userId: z.number().int().optional(),
      ratingKey: z.string().optional(),
      offset,
      limit: z.number().int().min(1).max(200).default(50),
    }),
    run: (input, { caller }) => caller.stats.history(input),
  }),

  defineTool({
    name: "list_users",
    title: "List users",
    description: "The Plex server's users — the owner, home users and shared friends — with their ids.",
    input: z.object({
      search: z.string().optional(),
      offset,
      limit: z.number().int().min(1).max(200).default(50),
    }),
    run: (input, { caller }) => caller.users.list(input),
  }),

  defineTool({
    name: "get_ai_usage",
    title: "AI usage",
    description:
      "LLM token usage by feature and by rule for this month and recent months, and the monthly budget if one is set.",
    input: z.object({}),
    run: (_input, { caller }) => caller.aiUsage.summary(),
  }),

  defineTool({
    name: "get_download_clients",
    title: "Download clients",
    description:
      "Each configured download client (SABnzbd, NZBGet, qBittorrent, Transmission, Deluge): whether it is " +
      "reachable, whether it is paused, its download speed in bytes per second, and the items still " +
      "downloading or queued with their state and progress. Finished torrents are left out.",
    input: z.object({}),
    run: (_input, { caller }) => caller.downloadClients.overview(),
  }),
];

export const TOOLS_BY_NAME: ReadonlyMap<string, AgentTool> = new Map(TOOLS.map((tool) => [tool.name, tool]));

/**
 * Shapes more than one native procedure returns.
 *
 * Generated once from the routers' inferred output types and then owned by
 * hand: each is attached to its procedure with `.output()`, so the server
 * validates what it sends and tRPC types the resolver against it — a resolver
 * that drifts from its schema is a typecheck error, not a native decode
 * failure. `native-codegen` turns these into the Swift and Kotlin models.
 *
 * Rules for anything in here (`native-api.test.ts` and codegen enforce them):
 * JSON-representable only — no `z.date()`, bigint, transforms or custom
 * types; timestamps are epoch milliseconds. `int()` marks an integer for the
 * native models without validating it, so a wrong guess fails one app decode
 * rather than the endpoint.
 */
import { z } from "zod";
import { int } from "./int.ts";
import { PROBLEM_KINDS } from "../problems.ts";

export const RuleRunTrigger = z
  .enum(["manual", "job", "cron", "chain", "item-added", "item-watched", "item-removed", "request-fulfilled"])
  .meta({ id: "RuleRunTrigger" });
export type RuleRunTrigger = z.infer<typeof RuleRunTrigger>;

/** One named type, so the native models share it between `problems.list` and the fix/dismiss inputs. */
export const ProblemKind = z.enum(PROBLEM_KINDS).meta({ id: "ProblemKind" });

export const RuleRunPhase = z.enum(["run", "test"]).meta({ id: "RuleRunPhase" });
export type RuleRunPhase = z.infer<typeof RuleRunPhase>;

export const MatchFilters = z
  .object({
    genres: z.array(z.string()).optional(),
    maxMinutes: z.number().optional(),
    minYear: z.number().optional(),
    maxYear: z.number().optional(),
    minRating: z.number().optional(),
    maxRating: z.number().optional(),
  })
  .meta({ id: "MatchFilters" });
export type MatchFilters = z.infer<typeof MatchFilters>;

export const MatchRoomSummary = z
  .object({ code: z.string(), library: z.string(), filters: MatchFilters, members: z.array(z.string()) })
  .meta({ id: "MatchRoomSummary" });
export type MatchRoomSummary = z.infer<typeof MatchRoomSummary>;

export const PlexSession = z
  .object({
    ratingKey: z.string().optional(),
    sessionKey: z.string().optional(),
    sessionId: z.string().optional(),
    parentRatingKey: z.string().optional(),
    grandparentRatingKey: z.string().optional(),
    librarySectionId: z.string().optional(),
    title: z.string(),
    type: z.string(),
    year: int().optional(),
    thumb: z.string().optional(),
    parentThumb: z.string().optional(),
    grandparentTitle: z.string().optional(),
    parentTitle: z.string().optional(),
    parentIndex: int().optional(),
    index: int().optional(),
    duration: z.number().optional(),
    viewOffset: z.number().optional(),
    user: z.string(),
    userId: int().optional(),
    userThumb: z.string().optional(),
    player: z.string(),
    playerMachineId: z.string().optional(),
    product: z.string().optional(),
    platform: z.string().optional(),
    state: z.string(),
    local: z.boolean().optional(),
    relayed: z.boolean().optional(),
    secure: z.boolean().optional(),
    address: z.string().optional(),
    location: z.string().optional(),
    bandwidth: z.number().optional(),
    decision: z.string(),
    videoResolution: z.string().optional(),
    videoCodec: z.string().optional(),
    audioCodec: z.string().optional(),
    audioChannels: z.number().optional(),
    container: z.string().optional(),
    videoDecision: z.string().optional(),
    audioDecision: z.string().optional(),
    transcodeSpeed: z.number().optional(),
    transcodeProgress: z.number().optional(),
    transcodeHwEncoding: z.boolean().optional(),
    sourceVideoCodec: z.string().optional(),
    sourceAudioCodec: z.string().optional(),
  })
  .meta({ id: "PlexSession" });
export type PlexSession = z.infer<typeof PlexSession>;

export const UserSummary = z
  .object({
    userId: int(),
    username: z.string(),
    name: z.string().nullable(),
    label: z.string(),
    collectionCount: int(),
    lastWatchedTitle: z.string().nullable(),
    lastWatchedRatingKey: z.string().nullable(),
    lastWatchedAt: int().nullable(),
    optedIn: z.boolean(),
    isOwner: z.boolean(),
    isHome: z.boolean(),
    isManaged: z.boolean(),
    isProtected: z.boolean(),
    accepted: z.boolean(),
    email: z.string().nullable(),
    thumb: z.string().nullable(),
    sharedServerId: int().nullable(),
    sharedSectionCount: int().nullable(),
  })
  .meta({ id: "UserSummary" });
export type UserSummary = z.infer<typeof UserSummary>;

export const RuleRunSummary = z
  .object({
    id: z.string(),
    ruleId: z.string(),
    phase: RuleRunPhase,
    trigger: RuleRunTrigger,
    jobRunId: z.string().nullable(),
    status: z.string(),
    progress: z.number(),
    message: z.string(),
    collectionCount: int().nullable(),
    itemCount: int().nullable(),
    error: z.string().nullable(),
    startedAt: int(),
    updatedAt: int(),
    finishedAt: int().nullable(),
    hasFunnel: z.boolean(),
    ruleName: z.string(),
  })
  .meta({ id: "RuleRunSummary" });
export type RuleRunSummary = z.infer<typeof RuleRunSummary>;

export const CollectionPerformance = z
  .object({
    members: int(),
    playedMembers: z.number(),
    plays: int(),
    viewers: z.number(),
    lastPlayedAt: int().nullable(),
  })
  .meta({ id: "CollectionPerformance" });
export type CollectionPerformance = z.infer<typeof CollectionPerformance>;

export const ActiveJobRun = z
  .object({ runId: z.string(), jobId: z.string(), name: z.string(), startedAt: int() })
  .meta({ id: "ActiveJobRun" });
export type ActiveJobRun = z.infer<typeof ActiveJobRun>;

export const MediaRef = z
  .object({ ratingKey: z.string(), title: z.string(), sectionTitle: z.string() })
  .meta({ id: "MediaRef" });
export type MediaRef = z.infer<typeof MediaRef>;

export const SignedIn = z
  .object({ status: z.literal("ok"), username: z.string(), token: z.string() })
  .meta({ id: "SignedIn" });
export type SignedIn = z.infer<typeof SignedIn>;

export const LogChunk = z
  .object({ chunk: z.string(), nextOffset: z.number(), size: z.number() })
  .meta({ id: "LogChunk" });
export type LogChunk = z.infer<typeof LogChunk>;

export const ValueCount = z.object({ value: z.string().nullable(), count: int() }).meta({ id: "ValueCount" });
export type ValueCount = z.infer<typeof ValueCount>;

export const StatsCoverage = z.object({ since: z.number(), coveredDays: z.number() }).meta({ id: "StatsCoverage" });
export type StatsCoverage = z.infer<typeof StatsCoverage>;

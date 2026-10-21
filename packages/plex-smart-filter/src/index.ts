/**
 * Plex smart-collection filter — parser, emitter, and Zod schema for
 * the recursive AND/OR clause tree that Plex stores in its smart
 * collection `content` URIs. Pure (no DB or network), so it can be
 * shared between the migration importer (`@rube/migrate`), the
 * runtime collection generator (`@rube/jobs`), and the rule
 * wizard UI (`@rube/web`) without dragging extra deps along.
 */
export { parseSmartFilterUri } from "./parse.ts";
export { emitSmartFilterTree } from "./emit.ts";
export { splitSmartFilterContent, restoreSmartFilterContent } from "./envelope.ts";
export type { SmartFilterEnvelope } from "./envelope.ts";
export { smartFilterLeafSchema, smartFilterGroupSchema, smartFilterNodeSchema } from "./schema.ts";
export { collectLocalLeaves, hasLocalLeaves, isLocalField, LOCAL_FIELD_PREFIX, splitLocalLeaves } from "./local.ts";
export type { SplitError, SplitResult } from "./local.ts";
export type { ParseResult, SmartFilterLeaf, SmartFilterGroup, SmartFilterNode, SmartFilterOp } from "./parse.ts";

import { z } from "zod";
import type { SmartFilterGroup, SmartFilterNode } from "./parse.ts";

/**
 * Runtime validation for the `smart_filter` rule config tree. Mirrors
 * the types in `parse.ts` so a stored rule config round-trips through
 * Zod without losing shape. Recursive groups are wired through
 * `z.lazy` since `children` references the union itself.
 */
export const smartFilterLeafSchema = z.object({
  kind: z.literal("leaf"),
  field: z.string().min(1),
  op: z.enum(["=", "==", "!=", ">=", "<=", ">", "<"]),
  value: z.string(),
});

export const smartFilterGroupSchema: z.ZodType<SmartFilterGroup> = z.object({
  kind: z.literal("group"),
  combinator: z.enum(["all", "any"]),
  children: z.lazy(() => z.array(smartFilterNodeSchema)),
});

export const smartFilterNodeSchema: z.ZodType<SmartFilterNode> = z.union([
  smartFilterLeafSchema,
  smartFilterGroupSchema,
]);

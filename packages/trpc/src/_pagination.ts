import { z } from "zod";

/**
 * Shared pagination input shape. Bounded so a malformed (negative offset)
 * or hostile (limit=10000) call can't return undefined SQL behaviour or
 * blow up server memory. The 500-item ceiling is comfortably above the
 * largest legitimate UI page size (200, used by Preview).
 */
export const paginationInput = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(500).default(50),
});

export type PaginationInput = z.infer<typeof paginationInput>;

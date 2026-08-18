import type { TrpcDeps } from "./deps.ts";
/**
 * Named list views.
 *
 * Thin by design. `useListParams` already puts every list page's search,
 * filters, sort and page into the URL, so a saved view is a stored query
 * string and nothing else — no per-page schema to keep in step, and a page
 * that gains a filter next month gains it in saved views for free.
 *
 * Server-side rather than localStorage because the column pickers next to them
 * already are, and a view that exists on one browser and not another is the
 * kind of half-feature people stop trusting.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { savedViews } from "@tinkerbell/db";
import { t, procedure } from "./_base.ts";

/**
 * Pages that may have views. A closed list so a typo'd page key can't quietly
 * create a namespace nothing will ever read from again.
 */
const PAGES = ["media", "collections", "rules", "events", "users"] as const;

const pageInput = { page: z.enum(PAGES) };

export function createViewsRouter(deps: Pick<TrpcDeps, "db">) {
  const { db } = deps;

  const viewsRouter = t.router({
    list: procedure.input(z.object(pageInput)).query(({ input }) => {
      return db
        .select()
        .from(savedViews)
        .where(eq(savedViews.page, input.page))
        .orderBy(savedViews.name)
        .all()
        .map((row) => ({ id: row.id, name: row.name, query: row.query }));
    }),

    /**
     * Save, or overwrite the view of the same name.
     *
     * Overwriting rather than erroring: "save this as My View" when My View
     * already exists means update it, and making the user delete-then-save to
     * express that is a worse answer than the one they expected.
     */
    save: procedure
      .input(z.object({ ...pageInput, name: z.string().trim().min(1).max(60), query: z.string().max(2000) }))
      .mutation(({ input }) => {
        const id = randomUUID();
        db.insert(savedViews)
          .values({ id, page: input.page, name: input.name, query: input.query, createdAt: Date.now() })
          .onConflictDoUpdate({
            target: [savedViews.page, savedViews.name],
            set: { query: input.query, createdAt: Date.now() },
          })
          .run();
        return { ok: true as const };
      }),

    delete: procedure.input(z.object({ ...pageInput, id: z.string() })).mutation(({ input }) => {
      db.delete(savedViews)
        .where(and(eq(savedViews.page, input.page), eq(savedViews.id, input.id)))
        .run();
      return { ok: true as const };
    }),
  });

  return viewsRouter;
}

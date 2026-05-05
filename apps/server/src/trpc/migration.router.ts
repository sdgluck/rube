import { z } from "zod";
import { startJob } from "#jobs/runner.ts";
import { buildKometaPlan, dismissMigrationBanner, getMigrationStatus, scanKometaState } from "#domains/migration.ts";
import { setConfig } from "@tinkerbell/core";
import { procedure, t } from "./_base.ts";

const runInputSchema = z.object({
  /** PlanItem keys (`bucket::sectionId`) the user opted to apply. */
  selectedKeys: z.array(z.string()).min(1),
  deleteOriginals: z.boolean().default(false),
});

export const migrationRouter = t.router({
  status: procedure.query(() => getMigrationStatus()),

  scan: procedure.mutation(() => scanKometaState()),

  dismiss: procedure.mutation(() => {
    dismissMigrationBanner();
    return { ok: true as const };
  }),

  previewPlan: procedure.query(() => buildKometaPlan()),

  run: procedure.input(runInputSchema).mutation(async ({ input }) => {
    const plan = buildKometaPlan();
    const selected = new Set(input.selectedKeys);
    const items = plan.proposed
      .filter((p) => selected.has(p.key))
      .map((p) => ({
        ruleType: p.ruleType,
        ruleName: p.ruleName,
        sectionId: p.sectionId,
        ruleConfig: p.ruleConfig,
        replacesRatingKeys: p.replacesRatingKeys,
      }));

    if (items.length === 0) {
      throw new Error("No proposed rules selected for migration.");
    }

    setConfig("migration_kometa_pending_plan", {
      items,
      deleteOriginals: input.deleteOriginals,
      submittedAt: Date.now(),
    });

    const result = await startJob("migrate-kometa");
    if (!result) throw new Error("Failed to start migrate-kometa job.");
    return { runId: result.runId };
  }),
});

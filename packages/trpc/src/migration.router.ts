import { z } from "zod";
import { startJob } from "@tinkerbell/jobs";
import {
  buildProviderPlan,
  dismissProvider,
  getMigrationStatus,
  getProvider,
  listProviders,
  scanProviderState,
} from "@tinkerbell/domain.migration";
import { setConfig } from "@tinkerbell/core";
import { procedure, t } from "./_base.ts";

const providerInput = z.object({ providerId: z.string().min(1) });

const runInputSchema = z.object({
  providerId: z.string().min(1),
  /** PlanItem keys (`bucket::sectionId`) the user opted to apply. */
  selectedKeys: z.array(z.string()).min(1),
  deleteOriginals: z.boolean().default(false),
});

export const migrationRouter = t.router({
  /** Aggregate status across every registered provider. */
  status: procedure.query(() => getMigrationStatus()),

  /** Static list of registered providers (id + label). For UI tabs. */
  providers: procedure.query(() => listProviders().map((p) => ({ id: p.id, label: p.label }))),

  scan: procedure.input(providerInput).mutation(({ input }) => scanProviderState(input.providerId)),

  dismiss: procedure.input(providerInput).mutation(({ input }) => {
    dismissProvider(input.providerId);
    return { ok: true as const };
  }),

  previewPlan: procedure.input(providerInput).query(({ input }) => buildProviderPlan(input.providerId)),

  run: procedure.input(runInputSchema).mutation(async ({ input }) => {
    // Validate provider id before doing anything stateful.
    getProvider(input.providerId);

    const plan = buildProviderPlan(input.providerId);
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

    setConfig("migration_pending_plan", {
      providerId: input.providerId,
      items,
      deleteOriginals: input.deleteOriginals,
      submittedAt: Date.now(),
    });

    const result = await startJob("migrate-collections");
    if (!result) throw new Error("Failed to start migrate-collections job.");
    return { runId: result.runId };
  }),
});

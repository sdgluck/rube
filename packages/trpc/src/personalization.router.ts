import type { TrpcDeps } from "./deps.ts";
import { TRPCError } from "@trpc/server";

import { t, procedure, mapNotConfiguredClient } from "./_base.ts";

const ENABLE_JOB = "personalize-enable";
const DISABLE_JOB = "personalize-disable";

/** Must match `BASELINE_LABEL` in the personalize-enable job. */
const BASELINE_LABEL = "Rube";

/**
 * Items per second when no labelling pass has been timed on this server yet.
 *
 * This was 25, described as "observed", and it wasn't: a real 4,859-item
 * library labelled at ~3/s with one item per request, so the confirmation said
 * ~3m for a 27-minute job. Labelling is now batched, which should be much
 * faster — but how much depends on the server, so the default stays the slow
 * number that was actually measured, and the job replaces it with its own
 * timing (`personalize_label_rate`) after its first real pass. Over-promising
 * on a job that restricts every user's sharing is the worse error.
 */
const DEFAULT_ITEMS_PER_SECOND = 3;
// Snapshot + sharing-restriction phases scale with user count, not items.
const BASELINE_SECONDS = 30;

export function createPersonalizationRouter(deps: Pick<TrpcDeps, "clients" | "config" | "jobs">) {
  const { startJob } = deps.jobs;
  const { config } = deps;
  const { getConfig } = config;
  const getPlexClient = mapNotConfiguredClient(deps.clients);

  async function start(jobId: string): Promise<{ runId: string }> {
    const result = await startJob(jobId);
    if (!result.ok) {
      throw result.reason === "already-running"
        ? new TRPCError({ code: "CONFLICT", message: `${jobId} is already running` })
        : new TRPCError({ code: "NOT_FOUND", message: `Job "${jobId}" is not available in this build` });
    }
    return { runId: result.runId };
  }

  const personalizationRouter = t.router({
    status: procedure.query(() => {
      return getConfig("global_personalized_sharing") ?? { status: "disabled" as const };
    }),

    /**
     * How much labelling an enable (or reconcile) has left, and how long it
     * should take.
     *
     * Counts only items still missing the label, asked of Plex directly — one
     * `label!=` count per library. Counting the whole local index meant a
     * reconcile on a fully labelled library still claimed every item.
     *
     * Per library too, with each one's total: a library where *nothing* carries
     * the label is one added since personalization was turned on — invisible
     * to every restricted user until a reconcile labels it — which is distinct
     * from a few new arrivals the label job hasn't reached yet.
     */
    estimate: procedure.query(async () => {
      const client = getPlexClient();
      const libraries = getConfig("global_plex_libraries");
      const sections = (await client.getSections()).filter(
        (s) => !libraries || libraries.length === 0 || libraries.includes(s.title),
      );
      const perLibrary = await Promise.all(
        sections.map(async (s) => {
          const [items, unlabelled] = await Promise.all([
            client.getSectionItemCount(s.key),
            client.getSectionItemCount(s.key, { "label!": BASELINE_LABEL }),
          ]);
          return { title: s.title, items, unlabelled };
        }),
      );
      const itemCount = perLibrary.reduce((a, b) => a + b.unlabelled, 0);
      const measured = getConfig("personalize_label_rate");
      const itemsPerSecond = measured?.itemsPerSecond ?? DEFAULT_ITEMS_PER_SECOND;
      const estimatedSeconds = Math.ceil(itemCount / itemsPerSecond) + BASELINE_SECONDS;
      return {
        itemCount,
        estimatedSeconds,
        measured: measured != null,
        unlabelledLibraries: perLibrary.filter((l) => l.items > 0 && l.unlabelled === l.items).map((l) => l.title),
      };
    }),

    enable: procedure.mutation(async () => {
      const status = getConfig("global_personalized_sharing")?.status ?? "disabled";
      if (status === "disabling") {
        throw new TRPCError({ code: "CONFLICT", message: "Personalization is currently being disabled." });
      }
      return start(ENABLE_JOB);
    }),

    disable: procedure.mutation(async () => {
      const status = getConfig("global_personalized_sharing")?.status ?? "disabled";
      if (status === "enabling") {
        throw new TRPCError({ code: "CONFLICT", message: "Personalization is currently being enabled." });
      }
      return start(DISABLE_JOB);
    }),

    // Re-apply restrictions to any newly-shared users (idempotent enable run).
    reconcile: procedure.mutation(async () => {
      const status = getConfig("global_personalized_sharing")?.status ?? "disabled";
      if (status !== "enabled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Personalization is not enabled." });
      }
      return start(ENABLE_JOB);
    }),
  });

  return personalizationRouter;
}

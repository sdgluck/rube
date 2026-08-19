import { randomUUID } from "node:crypto";
import { bundleLoader, readImport } from "@tinkerbell/migrate/kometa-yaml";
import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";

import { procedure, t } from "./_base.ts";

const providerInput = z.object({ providerId: z.string().min(1) });

const runInputSchema = z.object({
  providerId: z.string().min(1),
  /** `PlanItem.key`s the user opted to apply. */
  selectedKeys: z.array(z.string()).min(1),
  deleteOriginals: z.boolean().default(false),
  /**
   * Create the migrated rules switched on. Defaults to off: a migrated rule
   * that runs before anyone has looked at it will happily reshape a library
   * on the strength of a mapping the user hasn't reviewed.
   */
  enableRules: z.boolean().default(false),
  /** Bundle to plan from, for providers that ingest files. */
  importId: z.string().optional(),
  /**
   * Rebuild the Kometa overlay layout as Tinkerbell badges. Off by default —
   * it replaces whatever overlay configuration a library already has, which is
   * not something to do without being asked.
   */
  applyOverlays: z.boolean().default(false),
  /**
   * Store the per-item metadata edits from `metadata_files`. Storing is always
   * safe — they aren't written to Plex until the metadata-overrides job runs,
   * and that job respects the global metadata kill switch.
   */
  applyMetadata: z.boolean().default(false),
});

/**
 * A `config.yml` is a few KB; a whole `config/` directory with two dozen
 * collection files is a few hundred. The cap is generous enough for any real
 * Kometa setup and small enough that a mis-picked directory (Downloads, say)
 * is refused rather than parsed.
 */
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

const importFilesSchema = z.object({
  /** Files read client-side from the picker, or a single pasted config. */
  files: z
    .array(z.object({ path: z.string().min(1).max(1024), text: z.string() }))
    .min(1)
    .max(200)
    .optional(),
  /** Absolute path on the server to read instead — the true one-click path. */
  serverPath: z.string().min(1).optional(),
});

export function createMigrationRouter(deps: Pick<TrpcDeps, "collections" | "config" | "jobs" | "migration">) {
  const { startJob, testRule } = deps.jobs;
  const { getCollectionMemberKeys } = deps.collections;
  const { config, migration } = deps;
  const {
    buildProviderPlan,
    createKometaImport,
    dismissProvider,
    getMigrationStatus,
    getProvider,
    listProviders,
    loadKometaImport,
    readKometaServerPath,
    kometaMetadataOverridesFor,
    kometaOverlaysFor,
    resolveKometaSections,
    scanProviderState,
    setKometaSectionMap,
  } = migration;
  const { getConfig, setConfig } = config;

  const migrationRouter = t.router({
    /** Aggregate status across every registered provider. */
    status: procedure.query(() => getMigrationStatus()),

    /**
     * Registered providers, with the ingest descriptor so the UI knows which
     * ones need a file before they can plan anything.
     */
    providers: procedure.query(() =>
      listProviders().map((p) => ({ id: p.id, label: p.label, ingest: p.ingest ?? null })),
    ),

    /**
     * Accept a Kometa config bundle and report what's in it, before any
     * mapping is attempted. This is the Resolve step: which libraries were
     * found, which referenced files resolved, and what didn't parse.
     */
    importFiles: procedure.input(importFilesSchema).mutation(async ({ input }) => {
      if (!input.files && !input.serverPath) {
        throw new Error("Provide either the config files or a path on the server.");
      }

      const files = input.serverPath ? await readKometaServerPath(input.serverPath) : input.files!;

      const bytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.text), 0);
      if (bytes > MAX_IMPORT_BYTES) {
        throw new Error("That's more than an import can take — pick just your Kometa config directory.");
      }

      const importId = randomUUID();
      createKometaImport(importId, files);

      // Read it straight back so the wizard can show the file checklist and
      // the library mapping without a second round trip.
      const imported = await readImport({ files, loader: bundleLoader(files) });
      const libraries = imported.config.libraries.map((l) => l.libraryName ?? l.name);
      const guessed = resolveKometaSections(libraries, {});

      return {
        importId,
        libraries: libraries.map((name) => ({
          name,
          suggestedSectionId: guessed.get(name)?.sectionId ?? null,
          suggestedSectionTitle: guessed.get(name)?.sectionTitle ?? null,
        })),
        resolutions: imported.resolutions.map((r) => ({
          kind: r.ref.kind,
          value: r.ref.value,
          status: r.status,
          reason: r.status === "missing" ? r.reason : null,
          fileCount: r.status === "resolved" ? r.files.length : 0,
        })),
        definitionCount: imported.definitions.length,
        diagnostics: imported.diagnostics,
      };
    }),

    /** Record which Plex section each Kometa library maps onto. */
    setSectionMap: procedure
      .input(z.object({ importId: z.string().min(1), sectionMap: z.record(z.string(), z.string()) }))
      .mutation(({ input }) => {
        if (!loadKometaImport(input.importId)) {
          throw new Error("That import has expired. Upload your Kometa config again.");
        }
        setKometaSectionMap(input.importId, input.sectionMap);
        return { ok: true as const };
      }),

    /**
     * The rules the last migration created, and what each replaced.
     *
     * `checkable` is the number worth verifying: a rule migrated from a
     * definition that never built a Plex collection has nothing to compare
     * against, and listing it as unverified would imply a problem.
     */
    verifyTargets: procedure.query(() => {
      const result = getConfig("migration_last_result");
      if (!result) return null;
      return {
        providerId: result.providerId,
        completedAt: result.completedAt,
        entries: result.entries.map((e) => ({
          ruleId: e.ruleId,
          ruleName: e.ruleName,
          checkable: e.replacesRatingKeys.length > 0,
        })),
      };
    }),

    /**
     * Dry-run one migrated rule and compare it against the Kometa collection
     * it replaced.
     *
     * One rule per call, deliberately. A dry run indexes the whole library, so
     * verifying a hundred rules in one request would be a multi-minute
     * hostage-taking of a single HTTP connection; the UI walks the list and
     * shows progress instead.
     *
     * Nothing here writes to Plex — that's the point. The user gets to see
     * whether Tinkerbell reproduces their collections *before* letting it
     * near them.
     */
    verifyRule: procedure.input(z.object({ ruleId: z.string().min(1) })).mutation(async ({ input }) => {
      const result = getConfig("migration_last_result");
      const entry = result?.entries.find((e) => e.ruleId === input.ruleId);
      if (!entry) throw new Error("That rule isn't part of the last migration.");

      const before = new Set(getCollectionMemberKeys(entry.replacesRatingKeys));
      if (before.size === 0) {
        return { ruleName: entry.ruleName, comparable: false as const, kometa: 0, tinkerbell: 0, common: 0 };
      }

      const preview = await testRule(input.ruleId);
      const after = new Set(preview.collections.flatMap((c) => c.items.map((i) => i.ratingKey)));

      let common = 0;
      for (const key of after) if (before.has(key)) common++;

      return {
        ruleName: entry.ruleName,
        comparable: true as const,
        kometa: before.size,
        tinkerbell: after.size,
        common,
        // Titles read better than rating keys in the "what changed" lists, and
        // the preview is the only side that has them.
        onlyInTinkerbell: preview.collections
          .flatMap((c) => c.items)
          .filter((i) => !before.has(i.ratingKey))
          .slice(0, 50)
          .map((i) => i.title),
      };
    }),

    /** Per-item metadata edits found in the config. For the wizard. */
    previewMetadata: procedure.input(z.object({ importId: z.string().min(1) })).query(async ({ input }) => {
      const found = await kometaMetadataOverridesFor(input.importId);
      return found.map((entry) => ({
        sectionId: entry.sectionId,
        sectionTitle: entry.sectionTitle,
        count: entry.overrides.length,
        // A few titles make the number believable in a way the number alone
        // doesn't — "412 edits" reads as a guess until you see three of them.
        samples: entry.overrides.slice(0, 5).map((o) => o.match.title),
      }));
    }),

    /** What the overlay layout would become, per library. For the wizard. */
    previewOverlays: procedure
      .input(z.object({ importId: z.string().min(1) }))
      .query(({ input }) => kometaOverlaysFor(input.importId)),

    scan: procedure.input(providerInput).mutation(({ input }) => scanProviderState(input.providerId)),

    dismiss: procedure.input(providerInput).mutation(({ input }) => {
      dismissProvider(input.providerId);
      return { ok: true as const };
    }),

    previewPlan: procedure
      .input(providerInput.extend({ importId: z.string().optional() }))
      .query(({ input }) => buildProviderPlan(input.providerId, { importId: input.importId })),

    run: procedure.input(runInputSchema).mutation(async ({ input }) => {
      // Validate provider id before doing anything stateful.
      getProvider(input.providerId);

      const plan = await buildProviderPlan(input.providerId, { importId: input.importId });
      const selected = new Set(input.selectedKeys);
      const items = plan.proposed
        .filter((p) => selected.has(p.key))
        .map((p) => ({
          ruleType: p.ruleType,
          ruleName: p.ruleName,
          sectionId: p.sectionId,
          ruleConfig: p.ruleConfig,
          // Even when the user asks for enabled rules, anything the mapping
          // wasn't confident about stays off. "Partial" means the rule will
          // select a different set of items than Kometa did, and the whole
          // point of flagging it is that a person looks before it runs.
          enabled: input.enableRules && p.confidence !== "partial",
          replacesRatingKeys: p.replacesRatingKeys,
        }));

      if (items.length === 0) {
        throw new Error("No proposed rules selected for migration.");
      }

      // Guard against concurrent run() calls: the pending-plan slot is a
      // single-writer handoff to the migrate-collections job. Two near-
      // simultaneous mutations would clobber each other; the winning job
      // would then run the loser's selection. Refusing here is safer than
      // letting the second call silently overwrite.
      if (getConfig("migration_pending_plan")) {
        throw new Error("Another migration is already pending. Wait for it to finish before starting a new one.");
      }

      // Overlays ride on the plan so the job applies them: they're a write to
      // somebody's library, and they belong with every other write this
      // migration makes rather than happening here, out of the run log.
      const overlays = input.importId && input.applyOverlays ? await kometaOverlaysFor(input.importId) : [];
      const metadataOverrides =
        input.importId && input.applyMetadata
          ? (await kometaMetadataOverridesFor(input.importId)).map((entry) => ({
              sectionId: entry.sectionId,
              sectionTitle: entry.sectionTitle,
              overrides: entry.overrides.map((o) => ({ match: o.match, fields: o.fields, tags: o.tags })),
            }))
          : [];

      setConfig("migration_pending_plan", {
        providerId: input.providerId,
        items,
        deleteOriginals: input.deleteOriginals,
        overlays,
        metadataOverrides,
        submittedAt: Date.now(),
      });

      const result = await startJob("migrate-collections");
      if (!result.ok) {
        throw result.reason === "already-running"
          ? new Error("A collection migration is already running. Wait for it to finish, then try again.")
          : new Error("The migrate-collections job is missing. Restart Tinkerbell to re-seed it.");
      }
      return { runId: result.runId };
    }),
  });

  return migrationRouter;
}

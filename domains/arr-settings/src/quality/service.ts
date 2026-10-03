/**
 * Quality presets against real instances: plan, apply, check, restore.
 *
 * The planner decides *what* to write. This decides *whether* and *when*, and
 * keeps the record of having done it. Three rules shape it:
 *
 * - **Nothing is written that the user has not seen.** `apply` takes the
 *   fingerprint of the plan that was previewed, re-plans against the
 *   instance as it is now, and refuses on a mismatch. A preview computed before
 *   somebody edited the profile in Radarr's UI must not be applied over the
 *   top of that edit.
 * - **Every apply is undoable.** The profiles area is snapshotted before the
 *   first write, and the snapshot records which records were then touched.
 * - **Drift is reported, never repaired.** `checkInstance` writes a status and
 *   emits an event on the transition. Re-applying is the user's decision.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { arrManagedProfiles, arrSettingsSnapshots, type Db } from "@tinkerbell/db";
import { createLogger, currentActor, errorMessage, type ArrInstance, type ArrInstances } from "@tinkerbell/core";
import type { ChangeRecorder, Clock, EventBus } from "@tinkerbell/ports";
import {
  minimumMaxGb,
  presetsFor,
  qualityPreset,
  sizeLimitSchema,
  type QualityPreset,
  type SizeLimit,
} from "@tinkerbell/contracts";
import type { FieldChange } from "@tinkerbell/domain.config-history";
import { clientFor, qualityApiFor, readLive, type ArrClient } from "./live.ts";
import { planPreset, PlanError, type Plan, type PlanStep, type PlanTarget, type Sibling } from "./plan.ts";
import type { LiveQuality, QualityApi, WireCustomFormat, WireDefinition, WireProfile } from "./wire.ts";

const log = createLogger("arr-settings");

const SNAPSHOT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const SNAPSHOT_KEEP_NEWEST = 20;

export const MANAGED_STATUSES = ["unknown", "in_sync", "drifted", "missing", "update_available"] as const;
export type ManagedStatus = (typeof MANAGED_STATUSES)[number];

/** The preview went stale between looking and applying. */
export class PlanConflictError extends Error {
  constructor() {
    super("This instance changed since the preview was made. Review the new preview before applying.");
    this.name = "PlanConflictError";
  }
}

/** An apply that stopped partway. The snapshot undoes whatever did land. */
export class ApplyError extends Error {
  readonly snapshotId: string;
  constructor(message: string, snapshotId: string) {
    super(message);
    this.name = "ApplyError";
    this.snapshotId = snapshotId;
  }
}

export interface QualityServiceDeps {
  db: Db;
  arr: ArrInstances;
  /** Re-mirror profiles after a write, so pickers elsewhere see the new one at once. */
  refreshConfigMirror: (instance: ArrInstance, client: ArrClient) => Promise<void>;
  recordChange: ChangeRecorder;
  emitEvent: EventBus;
  now: Clock;
  /** Tests point this at a mock server's client. Production builds one per call. */
  connect?: (instance: ArrInstance) => { client: ArrClient; api: QualityApi };
}

export interface PlanRequest {
  instanceId: string;
  presetId: string;
  limit: SizeLimit;
  target: PlanTarget;
}

export type ManagedProfileRow = typeof arrManagedProfiles.$inferSelect;

export function createQualityService(deps: QualityServiceDeps) {
  const { db } = deps;

  function connect(instance: ArrInstance) {
    if (deps.connect) return deps.connect(instance);
    const client = clientFor(instance);
    return { client, api: qualityApiFor(instance, client) };
  }

  function requireInstance(instanceId: string): ArrInstance {
    const instance = deps.arr.arrInstances().find((i) => i.id === instanceId);
    if (!instance) throw new PlanError(`Unknown instance "${instanceId}"`);
    return instance;
  }

  function requirePreset(presetId: string, instance: ArrInstance): QualityPreset {
    const preset = qualityPreset(presetId);
    if (!preset) throw new PlanError(`Unknown preset "${presetId}"`);
    if (preset.service !== instance.service) throw new PlanError(`"${preset.name}" is a ${preset.service} preset`);
    return preset;
  }

  function rowsFor(instanceId: string): ManagedProfileRow[] {
    return db.select().from(arrManagedProfiles).where(eq(arrManagedProfiles.instanceId, instanceId)).all();
  }

  /** Every other applied profile on the instance, for the planner's loosest-wins rule. */
  function siblingsOf(rows: ManagedProfileRow[], excludeProfileId: number | null): Sibling[] {
    const out: Sibling[] = [];
    for (const row of rows) {
      if (row.arrProfileId === null || row.arrProfileId === excludeProfileId) continue;
      const preset = qualityPreset(row.presetId);
      const limit = sizeLimitSchema.safeParse(row.limits);
      if (preset && limit.success) out.push({ arrProfileId: row.arrProfileId, preset, limit: limit.data });
    }
    return out;
  }

  function buildPlan(req: PlanRequest, instance: ArrInstance, live: LiveQuality) {
    const preset = requirePreset(req.presetId, instance);
    const limit = sizeLimitSchema.parse(req.limit);
    const targetId = "profileId" in req.target ? req.target.profileId : null;
    const plan = planPreset({
      service: instance.service,
      preset,
      limit,
      target: req.target,
      live,
      siblings: siblingsOf(rowsFor(instance.id), targetId),
    });
    return { plan, preset, limit, fingerprint: fingerprintOf(req, plan) };
  }

  // ── Read ────────────────────────────────────────────────────────────────

  /** The catalogue for this instance's service, marked with what it can run. */
  async function presets(instanceId: string) {
    const instance = requireInstance(instanceId);
    const { api } = connect(instance);
    const { version } = await api.status();
    const capabilities = api.capabilities(version);
    return {
      service: instance.service,
      version,
      presets: presetsFor(instance.service).map((preset) => {
        const missing = preset.requires.filter((c) => !capabilities.includes(c));
        return {
          ...preset,
          available: missing.length === 0,
          unavailableReason:
            missing.length === 0
              ? null
              : missing.includes("customFormats")
                ? `Needs custom formats, which arrived in ${instance.service === "sonarr" ? "Sonarr v4" : "Radarr v3"}`
                : `Needs ${missing.join(", ")}`,
          minimumGb: minimumMaxGb(Math.max(...Object.values(preset.minMbPerMin)), preset.defaultLimit.basisMinutes),
        };
      }),
    };
  }

  /** The instance's profiles, with Tinkerbell's record of each it manages. */
  async function profiles(instanceId: string) {
    const instance = requireInstance(instanceId);
    const { api } = connect(instance);
    const live = await api.qualityProfiles();
    const rows = rowsFor(instanceId);
    const byProfile = new Map(rows.filter((r) => r.arrProfileId !== null).map((r) => [r.arrProfileId, r]));
    const liveIds = new Set(live.map((p) => p.id));
    return {
      profiles: live.map((p) => ({ id: p.id ?? 0, name: p.name, managed: byProfile.get(p.id ?? -1) ?? null })),
      // Rows whose profile is gone, or was never created: an import, or a
      // profile deleted in the *Arr's own UI.
      orphans: rows.filter((r) => r.arrProfileId === null || !liveIds.has(r.arrProfileId)),
    };
  }

  function managed(instanceId?: string): ManagedProfileRow[] {
    const q = db.select().from(arrManagedProfiles);
    return (instanceId ? q.where(eq(arrManagedProfiles.instanceId, instanceId)) : q).all();
  }

  // ── Plan and apply ──────────────────────────────────────────────────────

  async function plan(req: PlanRequest): Promise<{ plan: Plan; fingerprint: string }> {
    const instance = requireInstance(req.instanceId);
    const { api } = connect(instance);
    const live = await readLive(api);
    const built = buildPlan(req, instance, live);
    return { plan: built.plan, fingerprint: built.fingerprint };
  }

  async function apply(req: PlanRequest & { fingerprint: string }) {
    const instance = requireInstance(req.instanceId);
    const { api, client } = connect(instance);
    const live = await readLive(api);
    const { plan: current, preset, limit, fingerprint } = buildPlan(req, instance, live);
    if (fingerprint !== req.fingerprint) throw new PlanConflictError();

    const actor = currentActor();
    const snapshotId = randomUUID();
    const touched = {
      profiles: [] as number[],
      customFormats: [] as number[],
      definitions: [] as number[],
    };
    db.insert(arrSettingsSnapshots)
      .values({
        id: snapshotId,
        instanceId: instance.id,
        area: "profiles",
        payload: await api.readProfilesArea(),
        touched,
        reason: `Apply "${preset.name}" to ${current.profileName}`,
        createdAt: deps.now(),
        createdBy: actor.username || actor.source,
      })
      .run();
    const saveTouched = () =>
      db.update(arrSettingsSnapshots).set({ touched }).where(eq(arrSettingsSnapshots.id, snapshotId)).run();

    let profileId = "profileId" in req.target ? req.target.profileId : null;
    const formatIds = new Map(live.customFormats.map((f) => [f.name, f.id ?? 0]));
    let done = 0;
    try {
      // Formats first: the profile refers to them by id.
      for (const step of current.steps) {
        if (step.kind !== "customFormat") continue;
        if (step.action === "create") {
          const created = await api.createCustomFormat(step.body);
          formatIds.set(step.name, created.id ?? 0);
          if (created.id) touched.customFormats.push(created.id);
        } else {
          if (step.id) touched.customFormats.push(step.id);
          await api.updateCustomFormat(step.id ?? 0, step.body);
        }
        done++;
      }
      for (const step of current.steps) {
        if (step.kind !== "definitions") continue;
        touched.definitions.push(...step.body.map((d) => d.id));
        await api.updateQualityDefinitions(step.body);
        done++;
      }
      for (const step of current.steps) {
        if (step.kind !== "profile") continue;
        const body: WireProfile = {
          ...step.body,
          formatItems: (step.body.formatItems ?? []).map((f) => ({
            ...f,
            format: formatIds.get(f.name ?? "") ?? f.format,
          })),
        };
        if (step.action === "create") {
          const created = await api.createQualityProfile(body);
          profileId = created.id ?? null;
          if (profileId !== null) touched.profiles.push(profileId);
        } else {
          if (step.id) touched.profiles.push(step.id);
          await api.updateQualityProfile(step.id ?? 0, body);
        }
        done++;
      }
    } catch (err) {
      saveTouched();
      throw new ApplyError(
        `Stopped after ${done} of ${current.steps.length} changes: ${errorMessage(err)}. ` +
          `The snapshot taken before the apply can undo what did change.`,
        snapshotId,
      );
    }
    saveTouched();

    const row = upsertManaged({
      instance,
      profileId,
      profileName: current.profileName,
      preset,
      limit,
      appliedBy: actor.username || actor.source,
    });
    pruneSnapshots(instance.id);

    try {
      await deps.refreshConfigMirror(instance, client);
    } catch (err) {
      // The apply landed. A stale picker until tonight's sync is not worth failing it over.
      log.warn(`Mirror refresh after apply failed: ${errorMessage(err)}`);
    }

    return { managed: row, snapshotId, changes: current.steps.length };
  }

  function upsertManaged(a: {
    instance: ArrInstance;
    profileId: number | null;
    profileName: string;
    preset: QualityPreset;
    limit: SizeLimit;
    appliedBy: string;
  }): ManagedProfileRow {
    const { instance } = a;
    const existing =
      (a.profileId !== null
        ? db
            .select()
            .from(arrManagedProfiles)
            .where(
              and(eq(arrManagedProfiles.instanceId, instance.id), eq(arrManagedProfiles.arrProfileId, a.profileId)),
            )
            .get()
        : undefined) ??
      // An imported row waits under its name with no profile id yet.
      db
        .select()
        .from(arrManagedProfiles)
        .where(and(eq(arrManagedProfiles.instanceId, instance.id), eq(arrManagedProfiles.profileName, a.profileName)))
        .get();

    const values = {
      instanceId: instance.id,
      service: instance.service,
      arrProfileId: a.profileId,
      profileName: a.profileName,
      presetId: a.preset.id,
      presetVersion: a.preset.version,
      limits: a.limit as unknown as Record<string, unknown>,
      appliedAt: deps.now(),
      appliedBy: a.appliedBy,
      status: "in_sync" as ManagedStatus,
      drift: [],
      checkedAt: deps.now(),
      lastError: "",
    };

    let row: ManagedProfileRow;
    if (existing) {
      db.update(arrManagedProfiles).set(values).where(eq(arrManagedProfiles.id, existing.id)).run();
      row = { ...existing, ...values };
    } else {
      // A stale row may still hold this name for a profile that was renamed.
      db.delete(arrManagedProfiles)
        .where(and(eq(arrManagedProfiles.instanceId, instance.id), eq(arrManagedProfiles.profileName, a.profileName)))
        .run();
      row = { id: randomUUID(), ...values };
      db.insert(arrManagedProfiles).values(row).run();
    }

    deps.recordChange({
      entity: "arr_quality_profile",
      entityId: row.id,
      action: existing ? "update" : "create",
      before: existing ? historyShape(existing) : undefined,
      after: historyShape(row),
    });
    return row;
  }

  /** Stop managing a profile. It stays in the *Arr exactly as it is. */
  function detach(managedId: string): boolean {
    const row = db.select().from(arrManagedProfiles).where(eq(arrManagedProfiles.id, managedId)).get();
    if (!row) return false;
    db.delete(arrManagedProfiles).where(eq(arrManagedProfiles.id, managedId)).run();
    deps.recordChange({ entity: "arr_quality_profile", entityId: row.id, action: "delete", before: historyShape(row) });
    return true;
  }

  // ── Drift ───────────────────────────────────────────────────────────────

  /**
   * Re-plan every managed profile on one instance against what is there now.
   *
   * One read of the instance serves every row: the planner is pure, so
   * checking ten profiles costs ten plans and six requests, not sixty.
   */
  async function checkInstance(instanceId: string): Promise<ManagedProfileRow[]> {
    const rows = rowsFor(instanceId);
    if (rows.length === 0) return [];
    const instance = deps.arr.arrInstances().find((i) => i.id === instanceId);
    const now = deps.now();

    let live: LiveQuality;
    try {
      if (!instance) throw new Error("This instance is no longer configured");
      live = await readLive(connect(instance).api);
    } catch (err) {
      const lastError = errorMessage(err);
      db.update(arrManagedProfiles)
        .set({ lastError, checkedAt: now })
        .where(eq(arrManagedProfiles.instanceId, instanceId))
        .run();
      return rowsFor(instanceId);
    }

    for (const row of rows) {
      const next = evaluate(row, rows, instance, live);
      if ((next.status === "drifted" || next.status === "missing") && row.status !== next.status) {
        const what =
          next.status === "missing"
            ? "is missing"
            : `was changed outside Tinkerbell (${next.drift.length} differences)`;
        deps.emitEvent("arr.quality_drift", `“${row.profileName}” on ${instance.name} ${what}.`, {
          instanceId,
          managedId: row.id,
          status: next.status,
        });
      }
      db.update(arrManagedProfiles)
        .set({ status: next.status, drift: next.drift, lastError: next.lastError, checkedAt: now })
        .where(eq(arrManagedProfiles.id, row.id))
        .run();
    }
    return rowsFor(instanceId);
  }

  function evaluate(
    row: ManagedProfileRow,
    rows: ManagedProfileRow[],
    instance: ArrInstance,
    live: LiveQuality,
  ): { status: ManagedStatus; drift: FieldChange[]; lastError: string } {
    const preset = qualityPreset(row.presetId);
    if (!preset) return { status: "unknown", drift: [], lastError: `Preset "${row.presetId}" no longer exists` };
    if (row.arrProfileId === null || !live.profiles.some((p) => p.id === row.arrProfileId)) {
      return { status: "missing", drift: [], lastError: "" };
    }
    const limit = sizeLimitSchema.safeParse(row.limits);
    if (!limit.success) return { status: "unknown", drift: [], lastError: "Stored size limit is invalid" };
    try {
      const plan = planPreset({
        service: instance.service,
        preset,
        limit: limit.data,
        target: { profileId: row.arrProfileId },
        live,
        siblings: siblingsOf(rows, row.arrProfileId),
      });
      const drift = plan.steps.flatMap((s) => s.changes.map((c) => ({ ...c, path: `${stepLabel(s)}.${c.path}` })));
      // A newer catalogue entry is an update, not drift, even though a
      // re-apply would also change things: nothing happened in the *Arr.
      const status: ManagedStatus =
        preset.version > row.presetVersion ? "update_available" : drift.length > 0 ? "drifted" : "in_sync";
      return { status, drift, lastError: "" };
    } catch (err) {
      return { status: "unknown", drift: [], lastError: errorMessage(err) };
    }
  }

  /** Every instance with something managed on it. One instance failing does not stop the rest. */
  async function checkAll(): Promise<Array<{ instanceId: string; profiles: number; error?: string }>> {
    const instanceIds = [...new Set(managed().map((r) => r.instanceId))];
    const out: Array<{ instanceId: string; profiles: number; error?: string }> = [];
    for (const instanceId of instanceIds) {
      const rows = await checkInstance(instanceId);
      const error = rows.find((r) => r.lastError)?.lastError;
      out.push({ instanceId, profiles: rows.length, ...(error ? { error } : {}) });
    }
    return out;
  }

  // ── Snapshots ───────────────────────────────────────────────────────────

  function snapshots(instanceId: string) {
    return db
      .select({
        id: arrSettingsSnapshots.id,
        instanceId: arrSettingsSnapshots.instanceId,
        reason: arrSettingsSnapshots.reason,
        touched: arrSettingsSnapshots.touched,
        createdAt: arrSettingsSnapshots.createdAt,
        createdBy: arrSettingsSnapshots.createdBy,
      })
      .from(arrSettingsSnapshots)
      .where(eq(arrSettingsSnapshots.instanceId, instanceId))
      .orderBy(desc(arrSettingsSnapshots.createdAt))
      .all();
  }

  /**
   * Put back exactly the records one apply touched.
   *
   * A record that existed before is PUT back as it was. A record the apply
   * created is deleted. The *Arr refuses to delete a profile still assigned
   * to films, and that refusal is reported rather than worked around:
   * reassigning someone's library is not an undo.
   */
  async function restore(snapshotId: string): Promise<{ restored: number; warnings: string[] }> {
    const snap = db.select().from(arrSettingsSnapshots).where(eq(arrSettingsSnapshots.id, snapshotId)).get();
    if (!snap) throw new PlanError("That snapshot no longer exists");
    const instance = requireInstance(snap.instanceId);
    const { api, client } = connect(instance);

    const before = {
      profiles: asArray<WireProfile>(snap.payload["/qualityprofile"]),
      formats: asArray<WireCustomFormat>(snap.payload["/customformat"]),
      definitions: asArray<WireDefinition>(snap.payload["/qualitydefinition"]),
    };
    const warnings: string[] = [];
    const deletedProfiles = new Set<number>();
    let restored = 0;

    for (const id of snap.touched.profiles) {
      const old = before.profiles.find((p) => p.id === id);
      try {
        if (old) await api.updateQualityProfile(id, old);
        else {
          await api.deleteQualityProfile(id);
          deletedProfiles.add(id);
        }
        restored++;
      } catch (err) {
        warnings.push(`Profile ${old?.name ?? id}: ${errorMessage(err)}`);
      }
    }
    for (const id of snap.touched.customFormats) {
      const old = before.formats.find((f) => f.id === id);
      try {
        if (old) await api.updateCustomFormat(id, old);
        else await api.deleteCustomFormat(id);
        restored++;
      } catch (err) {
        warnings.push(`Custom format ${old?.name ?? id}: ${errorMessage(err)}`);
      }
    }
    const definitions = before.definitions.filter((d) => snap.touched.definitions.includes(d.id));
    if (definitions.length > 0) {
      try {
        await api.updateQualityDefinitions(definitions);
        restored += definitions.length;
      } catch (err) {
        warnings.push(`Quality sizes: ${errorMessage(err)}`);
      }
    }

    // A profile the apply created and the restore deleted is no longer managed.
    const affected = db
      .select()
      .from(arrManagedProfiles)
      .where(
        and(
          eq(arrManagedProfiles.instanceId, instance.id),
          inArray(arrManagedProfiles.arrProfileId, snap.touched.profiles),
        ),
      )
      .all();
    for (const row of affected) {
      if (deletedProfiles.has(row.arrProfileId ?? -1)) {
        db.delete(arrManagedProfiles).where(eq(arrManagedProfiles.id, row.id)).run();
      }
      deps.recordChange({
        entity: "arr_quality_profile",
        entityId: row.id,
        action: "restore",
        before: historyShape(row),
      });
    }

    await checkInstance(instance.id);
    try {
      await deps.refreshConfigMirror(instance, client);
    } catch (err) {
      log.warn(`Mirror refresh after restore failed: ${errorMessage(err)}`);
    }
    return { restored, warnings };
  }

  function pruneSnapshots(instanceId: string): void {
    const keep = db
      .select({ id: arrSettingsSnapshots.id })
      .from(arrSettingsSnapshots)
      .where(eq(arrSettingsSnapshots.instanceId, instanceId))
      .orderBy(desc(arrSettingsSnapshots.createdAt))
      .limit(SNAPSHOT_KEEP_NEWEST)
      .all()
      .map((r) => r.id);
    db.delete(arrSettingsSnapshots)
      .where(
        and(
          eq(arrSettingsSnapshots.instanceId, instanceId),
          lt(arrSettingsSnapshots.createdAt, deps.now() - SNAPSHOT_RETENTION_MS),
          keep.length > 0 ? notInArray(arrSettingsSnapshots.id, keep) : undefined,
        ),
      )
      .run();
  }

  // ── Portability ─────────────────────────────────────────────────────────

  /**
   * Bring managed rows in from a bundle.
   *
   * They arrive without a profile id, because the source install's ids mean
   * nothing here, and with status `missing`. The instance page then offers to
   * apply each one. Nothing is written to an *Arr as a side effect of an
   * import.
   */
  function importManaged(
    rows: Array<{ instanceId: string; profileName: string; presetId: string; limits: SizeLimit }>,
    opts: { overwrite?: boolean } = {},
  ): number {
    let imported = 0;
    for (const r of rows) {
      const instance = deps.arr.arrInstances().find((i) => i.id === r.instanceId);
      const preset = qualityPreset(r.presetId);
      if (!instance || !preset || preset.service !== instance.service) continue;
      const exists = db
        .select()
        .from(arrManagedProfiles)
        .where(and(eq(arrManagedProfiles.instanceId, r.instanceId), eq(arrManagedProfiles.profileName, r.profileName)))
        .get();
      if (exists && !opts.overwrite) continue;
      if (exists) {
        // The decision changes. The *Arr does not, until somebody re-applies,
        // so the row stays attached to its profile and is re-checked.
        const next = {
          presetId: preset.id,
          limits: sizeLimitSchema.parse(r.limits) as unknown as Record<string, unknown>,
          status: "unknown" as ManagedStatus,
        };
        db.update(arrManagedProfiles).set(next).where(eq(arrManagedProfiles.id, exists.id)).run();
        deps.recordChange({
          entity: "arr_quality_profile",
          entityId: exists.id,
          action: "import",
          before: historyShape(exists),
          after: historyShape({ ...exists, ...next }),
        });
        imported++;
        continue;
      }
      const row = {
        id: randomUUID(),
        instanceId: r.instanceId,
        service: instance.service,
        arrProfileId: null,
        profileName: r.profileName,
        presetId: preset.id,
        presetVersion: preset.version,
        limits: sizeLimitSchema.parse(r.limits) as unknown as Record<string, unknown>,
        appliedAt: null,
        appliedBy: null,
        status: "missing",
        drift: [],
        checkedAt: null,
        lastError: "",
      };
      db.insert(arrManagedProfiles).values(row).run();
      deps.recordChange({
        entity: "arr_quality_profile",
        entityId: row.id,
        action: "import",
        after: historyShape(row),
      });
      imported++;
    }
    return imported;
  }

  return {
    presets,
    profiles,
    managed,
    plan,
    apply,
    detach,
    checkInstance,
    checkAll,
    snapshots,
    restore,
    importManaged,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** What the change log keeps for a managed profile: the decision, not the *Arr's record. */
function historyShape(row: ManagedProfileRow) {
  return {
    instanceId: row.instanceId,
    profileName: row.profileName,
    presetId: row.presetId,
    presetVersion: row.presetVersion,
    limits: row.limits,
  };
}

function stepLabel(step: PlanStep): string {
  if (step.kind === "definitions") return "sizes";
  if (step.kind === "profile") return "profile";
  return `format[${step.name}]`;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * A plan's identity. Same instance state, same inputs → same fingerprint.
 *
 * Keys are sorted first, because two reads of the same document can come back
 * with their keys in a different order and must not look like a change.
 */
function fingerprintOf(req: PlanRequest, plan: Plan): string {
  const stable = JSON.stringify(
    { target: req.target, presetId: req.presetId, limit: req.limit, steps: plan.steps },
    (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, (value as Record<string, unknown>)[k]]),
          )
        : value,
  );
  return createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

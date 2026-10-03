/**
 * Preset + limit + live instance → the exact writes that would make them agree.
 *
 * Pure: no I/O, no clock, no randomness. Everything the planner knows arrives
 * in `PlanInput`, so the same live state always produces the same plan. That
 * determinism carries three features:
 *
 * - **The preview is the apply.** `apply` re-reads the instance, re-plans, and
 *   refuses if the plan's fingerprint moved since the user looked at it.
 * - **Drift detection is "would a re-apply change anything?"** No second
 *   comparison is maintained alongside this one, so the two cannot disagree.
 * - **Idempotence is testable.** Apply, then plan again: the plan is empty.
 *
 * What the planner owns, and therefore diffs and writes, is deliberately
 * narrow: the quality list and cutoff, the upgrade scores, the scores of
 * library formats (`CUSTOM_FORMATS`) and of this profile's own size format,
 * the library formats' specifications, and the definitions of qualities some
 * managed profile allows. A score the user gave one of their *own* formats is
 * left exactly as it is, and so is everything else on the record, because the
 * \*Arrs replace records wholesale on PUT.
 */

import {
  customFormatDef,
  CUSTOM_FORMATS,
  mbPerMinute,
  gbForRuntime,
  presetQualityNames,
  QUALITY_DEFINITION_MAX_MB_PER_MIN,
  type ArrService,
  type CustomFormatSpecDef,
  type QualityPreset,
  type SizeLimit,
} from "@tinkerbell/contracts";
import { diffSnapshots, type FieldChange } from "@tinkerbell/domain.config-history";
import type { LiveQuality, WireCustomFormat, WireDefinition, WireProfile, WireProfileItem, WireSpec } from "./wire.ts";

/** Scored this low, a format is never grabbed: the presets' minimum is 0. */
export const REJECT_SCORE = -10000;

/** The upper bound of the size format's range. Above any real release. */
const SIZE_SPEC_MAX_GB = 1000;

/** Sonarr's `ReleaseTypeSpecification` value for a single episode. */
const SONARR_SINGLE_EPISODE = 1;

/** Group ids must not collide with quality ids. The *Arrs start them at 1000. */
const FIRST_GROUP_ID = 1000;

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export type PlanTarget = { profileId: number } | { name: string };

/** Another managed profile on the same instance, for loosest-wins. */
export interface Sibling {
  arrProfileId: number | null;
  preset: QualityPreset;
  limit: SizeLimit;
}

export interface PlanInput {
  service: ArrService;
  preset: QualityPreset;
  limit: SizeLimit;
  target: PlanTarget;
  live: LiveQuality;
  siblings: Sibling[];
}

export interface CustomFormatStep {
  kind: "customFormat";
  action: "create" | "update";
  name: string;
  /** Set for an update. */
  id?: number;
  body: WireCustomFormat;
  before: NormalCustomFormat | null;
  after: NormalCustomFormat;
  changes: FieldChange[];
}

export interface DefinitionsStep {
  kind: "definitions";
  action: "update";
  /** Only the rows that change. */
  body: WireDefinition[];
  before: Record<string, SizeRow>;
  after: Record<string, SizeRow>;
  changes: FieldChange[];
}

export interface ProfileStep {
  kind: "profile";
  action: "create" | "update";
  name: string;
  id?: number;
  /**
   * The body to send. `formatItems[].format` is 0 for a format the plan is
   * about to create. The applier fills it in by name, once it has the id.
   */
  body: WireProfile;
  before: NormalProfile | null;
  after: NormalProfile;
  changes: FieldChange[];
}

export type PlanStep = CustomFormatStep | DefinitionsStep | ProfileStep;

export interface Plan {
  profileName: string;
  steps: PlanStep[];
  warnings: string[];
  /** For the preview: what the limit means in sizes people recognise. */
  sizes: { mbPerMinute: number; examples: Array<{ minutes: number; gb: number }>; ceilingGb: number | null };
}

/** What the planner compares. Keyed by name, so a diff reads as names. */
export interface NormalProfile {
  name: string;
  upgradeAllowed: boolean;
  cutoff: string;
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore: number;
  /** Best first. A group renders as `Group (A, B)`. */
  qualities: string[];
  /** Owned formats only, non-zero only. */
  scores: Record<string, number>;
}

export interface NormalCustomFormat {
  specifications: Record<
    string,
    { implementation: string; negate: boolean; required: boolean; fields: Record<string, unknown> }
  >;
}

export interface SizeRow {
  min: number | null;
  preferred: number | null;
  max: number | null;
}

/** The per-profile size format's name. One per profile, so it can carry that profile's ceiling. */
export function sizeFormatName(profileName: string): string {
  return `Size (Tinkerbell: ${profileName})`;
}

const SIZE_FORMAT_PREFIX = "Size (Tinkerbell: ";

const LIBRARY_NAMES = new Set<string>(CUSTOM_FORMATS.map((f) => f.name));

/** Formats whose score in a managed profile Tinkerbell decides. */
function isOwnedFormat(name: string): boolean {
  return LIBRARY_NAMES.has(name) || name.startsWith(SIZE_FORMAT_PREFIX);
}

export function planPreset(input: PlanInput): Plan {
  const { preset, limit, live, service } = input;
  const warnings: string[] = [];

  if (preset.service !== service) {
    throw new PlanError(`"${preset.name}" is a ${preset.service} preset`);
  }
  for (const capability of preset.requires) {
    if (!live.capabilities.includes(capability)) {
      throw new PlanError(
        `"${preset.name}" needs ${describeCapability(capability)}, which this instance (v${live.version || "?"}) does not have`,
      );
    }
  }

  const rate = mbPerMinute(limit);
  const allowed = presetQualityNames(preset);
  for (const name of allowed) {
    const floor = preset.minMbPerMin[name] ?? 0;
    if (floor > rate) {
      throw new PlanError(
        `${limit.maxGb} GB per ${limit.basisMinutes} min is below the smallest a ${name} release can be ` +
          `(${gbForRuntime(floor, limit.basisMinutes)} GB). Raise the limit or pick a smaller preset.`,
      );
    }
  }

  // ── The target ──────────────────────────────────────────────────────────
  let liveProfile: WireProfile | null = null;
  let profileName: string;
  if ("profileId" in input.target) {
    const id = input.target.profileId;
    liveProfile = live.profiles.find((p) => p.id === id) ?? null;
    if (!liveProfile) throw new PlanError(`Quality profile ${id} no longer exists on this instance`);
    profileName = liveProfile.name;
  } else {
    profileName = input.target.name.trim();
    if (!profileName) throw new PlanError("A new profile needs a name");
    if (live.profiles.some((p) => p.name === profileName)) {
      throw new PlanError(`A profile named "${profileName}" already exists. Choose it as the target to take it over.`);
    }
  }

  // ── Custom formats ──────────────────────────────────────────────────────
  const templates = new Map(live.specSchema.map((s) => [s.implementation, s]));
  const liveFormats = new Map(live.customFormats.map((f) => [f.name, f]));
  const wanted = new Map<string, CustomFormatSpecDef[]>();

  for (const { name } of preset.customFormats) {
    const specs = customFormatDef(name)?.specs[service];
    if (!specs) throw new PlanError(`Custom format "${name}" has no ${service} definition`);
    wanted.set(name, specs);
  }

  const scores = new Map<string, number>(preset.customFormats.map((f) => [f.name, f.score]));
  const sizeName = sizeFormatName(profileName);
  if (limit.ceilingGb !== null) {
    if (templates.has("SizeSpecification")) {
      wanted.set(sizeName, sizeSpecs(service, limit.ceilingGb));
      scores.set(sizeName, REJECT_SCORE);
    } else {
      warnings.push(
        `This instance's custom formats cannot match on size, so the ${limit.ceilingGb} GB per-file ceiling ` +
          `is skipped. The per-minute limit still applies.`,
      );
    }
  }

  const steps: PlanStep[] = [];
  for (const [name, specs] of wanted) {
    const body = buildFormat(name, specs, templates, liveFormats.get(name));
    const after = normaliseFormat(body);
    const existing = liveFormats.get(name);
    if (!existing) {
      steps.push({
        kind: "customFormat",
        action: "create",
        name,
        body,
        before: null,
        after,
        changes: diffSnapshots({}, after),
      });
      continue;
    }
    const before = normaliseFormat(existing);
    const changes = diffSnapshots(before, after);
    if (changes.length > 0) {
      steps.push({ kind: "customFormat", action: "update", name, id: existing.id, body, before, after, changes });
    }
  }

  // ── Quality definitions ─────────────────────────────────────────────────
  const definitions = planDefinitions(input, liveProfile?.id ?? null, warnings);
  if (definitions) steps.push(definitions);

  // ── The profile ─────────────────────────────────────────────────────────
  const qualityTable = flattenQualities(live.profileSchema.items ?? []);
  const { items, cutoff } = buildItems(preset, qualityTable);

  const allFormatNames = new Set([...live.customFormats.map((f) => f.name), ...wanted.keys()]);
  const liveScores = new Map((liveProfile?.formatItems ?? []).map((f) => [f.name ?? "", f.score]));
  const formatIds = new Map(live.customFormats.map((f) => [f.name, f.id ?? 0]));
  const formatItems = [...allFormatNames].sort().map((name) => ({
    format: formatIds.get(name) ?? 0,
    name,
    // A format outside the library keeps whatever the user scored it.
    score: isOwnedFormat(name) ? (scores.get(name) ?? 0) : (liveScores.get(name) ?? 0),
  }));

  const base = liveProfile ?? { ...live.profileSchema };
  const body: WireProfile = {
    ...base,
    name: profileName,
    upgradeAllowed: preset.upgradeAllowed,
    cutoff,
    minFormatScore: preset.minFormatScore,
    cutoffFormatScore: preset.cutoffFormatScore,
    minUpgradeFormatScore: preset.minUpgradeFormatScore,
    items,
    formatItems,
  };
  if (!liveProfile) delete body.id;

  const after = normaliseProfile(body);
  if (!liveProfile) {
    steps.push({
      kind: "profile",
      action: "create",
      name: profileName,
      body,
      before: null,
      after,
      changes: diffSnapshots({}, after),
    });
  } else {
    const before = normaliseProfile(liveProfile);
    const changes = diffSnapshots(before, after);
    if (changes.length > 0) {
      steps.push({
        kind: "profile",
        action: "update",
        name: profileName,
        id: liveProfile.id,
        body,
        before,
        after,
        changes,
      });
    }
  }

  return {
    profileName,
    steps,
    warnings,
    sizes: {
      mbPerMinute: rate,
      examples: [45, 90, 120, 180].map((minutes) => ({ minutes, gb: gbForRuntime(rate, minutes) })),
      ceilingGb: limit.ceilingGb,
    },
  };
}

// ── Custom formats ────────────────────────────────────────────────────────

function sizeSpecs(service: ArrService, ceilingGb: number): CustomFormatSpecDef[] {
  const size: CustomFormatSpecDef = {
    name: "Over ceiling",
    implementation: "SizeSpecification",
    required: true,
    fields: { min: ceilingGb, max: SIZE_SPEC_MAX_GB },
  };
  if (service === "radarr") return [size];
  // Sonarr measures a season pack as one release. Without this the ceiling
  // meant for one episode would reject every pack.
  return [
    size,
    {
      name: "Single episode",
      implementation: "ReleaseTypeSpecification",
      required: true,
      fields: { value: SONARR_SINGLE_EPISODE },
    },
  ];
}

function buildFormat(
  name: string,
  specs: CustomFormatSpecDef[],
  templates: Map<string, WireSpec>,
  existing: WireCustomFormat | undefined,
): WireCustomFormat {
  const specifications = specs.map((spec): WireSpec => {
    const template = templates.get(spec.implementation);
    if (!template) {
      throw new PlanError(`Custom format "${name}" needs ${spec.implementation}, which this instance does not support`);
    }
    // Schema-driven, as `mergeFieldValues` in servarr-http is: every field the
    // instance declares is sent, so one added by a newer release keeps its
    // default rather than being dropped.
    const fields = template.fields.map((f) =>
      f.name in spec.fields ? { ...f, value: spec.fields[f.name] } : { ...f },
    );
    return {
      name: spec.name,
      implementation: spec.implementation,
      implementationName: template.implementationName,
      negate: spec.negate ?? false,
      required: spec.required ?? false,
      fields,
    };
  });
  return {
    ...(existing ? { id: existing.id } : {}),
    name,
    includeCustomFormatWhenRenaming: existing?.includeCustomFormatWhenRenaming ?? false,
    specifications,
  };
}

export function normaliseFormat(format: WireCustomFormat): NormalCustomFormat {
  const specifications: NormalCustomFormat["specifications"] = {};
  for (const spec of format.specifications ?? []) {
    specifications[spec.name] = {
      implementation: spec.implementation,
      negate: spec.negate ?? false,
      required: spec.required ?? false,
      fields: Object.fromEntries((spec.fields ?? []).map((f) => [f.name, f.value ?? null])),
    };
  }
  return { specifications };
}

// ── Profiles ──────────────────────────────────────────────────────────────

interface QualityRef {
  id: number;
  name: string;
  quality: NonNullable<WireProfileItem["quality"]>;
}

/** Every quality in the schema, lowest first, whatever groups it came in. */
function flattenQualities(items: WireProfileItem[]): QualityRef[] {
  const out: QualityRef[] = [];
  const walk = (list: WireProfileItem[]) => {
    for (const item of list) {
      if (item.quality) out.push({ id: item.quality.id, name: item.quality.name, quality: item.quality });
      walk(item.items ?? []);
    }
  };
  walk(items);
  return out;
}

/**
 * The full `items` list: every quality the instance knows, disallowed ones
 * first (lowest), then the preset's in reverse, because the *Arrs order
 * lowest preference first. Groups are rebuilt from the preset, never kept
 * from the schema, whose default `WEB 1080p` group is not the same as a
 * preset's `1080p` group.
 */
function buildItems(preset: QualityPreset, table: QualityRef[]): { items: WireProfileItem[]; cutoff: number } {
  const byName = new Map(table.map((q) => [q.name, q]));
  const lookup = (name: string) => {
    const ref = byName.get(name);
    if (!ref) throw new PlanError(`This instance has no quality called "${name}"`);
    return ref;
  };
  const single = (name: string, allowed: boolean): WireProfileItem => ({
    quality: lookup(name).quality,
    items: [],
    allowed,
  });

  const allowedNames = new Set(presetQualityNames(preset));
  const disallowed = table.filter((q) => !allowedNames.has(q.name)).map((q) => single(q.name, false));

  let groupId = FIRST_GROUP_ID;
  let cutoff: number | null = null;
  const allowed = preset.qualities.map((entry): WireProfileItem => {
    if (typeof entry === "string") {
      if (entry === preset.cutoff) cutoff = lookup(entry).id;
      return single(entry, true);
    }
    const id = groupId++;
    if (entry.group === preset.cutoff) cutoff = id;
    return { id, name: entry.group, items: entry.qualities.map((q) => single(q, true)), allowed: true };
  });

  if (cutoff === null) throw new PlanError(`"${preset.name}" has a cutoff that is not one of its qualities`);
  return { items: [...disallowed, ...allowed.reverse()], cutoff };
}

export function normaliseProfile(profile: WireProfile): NormalProfile {
  const items = profile.items ?? [];
  const qualities: string[] = [];
  let cutoff = "";
  for (const item of [...items].reverse()) {
    const label = item.quality
      ? item.quality.name
      : `${item.name ?? "Group"} (${(item.items ?? []).map((i) => i.quality?.name ?? "?").join(", ")})`;
    if (item.allowed) qualities.push(label);
    const id = item.quality ? item.quality.id : item.id;
    if (id === profile.cutoff) cutoff = item.quality ? item.quality.name : (item.name ?? "");
  }
  const scores: Record<string, number> = {};
  for (const f of profile.formatItems ?? []) {
    if (f.name && isOwnedFormat(f.name) && f.score !== 0) scores[f.name] = f.score;
  }
  return {
    name: profile.name,
    upgradeAllowed: profile.upgradeAllowed ?? false,
    cutoff,
    minFormatScore: profile.minFormatScore ?? 0,
    cutoffFormatScore: profile.cutoffFormatScore ?? 0,
    minUpgradeFormatScore: profile.minUpgradeFormatScore ?? 1,
    qualities,
    scores,
  };
}

// ── Quality definitions ───────────────────────────────────────────────────

/**
 * Size bounds per quality, loosest across every managed profile.
 *
 * Definitions are instance-wide, so the bound written for a quality has to
 * admit the most generous managed profile that allows it. Otherwise applying a
 * compact preset would quietly shrink the remux profile next to it. The
 * per-profile size format is what keeps a compact profile compact.
 */
function planDefinitions(input: PlanInput, targetId: number | null, warnings: string[]): DefinitionsStep | null {
  const { preset, limit, live, service } = input;
  const cap = QUALITY_DEFINITION_MAX_MB_PER_MIN[service];

  const contributors = [
    { preset, limit },
    ...input.siblings.filter((s) => s.arrProfileId === null || s.arrProfileId !== targetId),
  ];
  const bounds = new Map<string, { max: number; min: number }>();
  for (const c of contributors) {
    const rate = Math.min(cap, mbPerMinute(c.limit));
    for (const name of presetQualityNames(c.preset)) {
      const min = c.preset.minMbPerMin[name] ?? 0;
      const prev = bounds.get(name);
      bounds.set(name, prev ? { max: Math.max(prev.max, rate), min: Math.min(prev.min, min) } : { max: rate, min });
    }
  }

  const before: Record<string, SizeRow> = {};
  const after: Record<string, SizeRow> = {};
  const body: WireDefinition[] = [];
  for (const row of live.definitions) {
    const bound = bounds.get(row.quality.name);
    if (!bound) continue;
    // Preferred sits at the ceiling: within the limit, bigger is better.
    const next = { min: bound.min, preferred: bound.max, max: bound.max };
    const current = { min: row.minSize, preferred: row.preferredSize, max: row.maxSize };
    if (sameRow(current, next)) continue;
    before[row.quality.name] = current;
    after[row.quality.name] = next;
    body.push({ ...row, minSize: next.min, preferredSize: next.preferred, maxSize: next.max });
  }
  if (body.length === 0) return null;

  const managedIds = new Set(
    [targetId, ...input.siblings.map((s) => s.arrProfileId)].filter((id): id is number => id !== null),
  );
  const unmanaged = live.profiles.filter((p) => p.id !== undefined && !managedIds.has(p.id)).length;
  if (unmanaged > 0) {
    warnings.push(
      `Size limits are instance-wide. They also apply to ${unmanaged} profile${unmanaged === 1 ? "" : "s"} ` +
        `Tinkerbell does not manage.`,
    );
  }

  return { kind: "definitions", action: "update", body, before, after, changes: diffSnapshots(before, after) };
}

function sameRow(a: SizeRow, b: SizeRow): boolean {
  const close = (x: number | null, y: number | null) => (x === null || y === null ? x === y : Math.abs(x - y) < 0.05);
  return close(a.min, b.min) && close(a.preferred, b.preferred) && close(a.max, b.max);
}

function describeCapability(capability: string): string {
  return capability === "customFormats" ? "custom formats (Sonarr v4 or later)" : capability;
}

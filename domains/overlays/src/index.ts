import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import { overlayConfigs, overlayOriginals, overlayPresets, type Db } from "@tinkerbell/db";
import type { ChangeRecorder } from "@tinkerbell/ports";
import {
  badgeStyleSchema,
  conditionalRuleSchema,
  overlayPositionSchema,
  overlayTypeSchema,
  type BadgeStyle,
  type ConditionalRule,
  type OverlayPosition,
  type OverlayType,
} from "@tinkerbell/overlays";
import { token } from "@tinkerbell/container";

export {
  overlayPositionSchema,
  overlayTypeSchema,
  badgeStyleSchema,
  conditionalRuleSchema,
  OVERLAY_POSITIONS,
  OVERLAY_TYPES,
  resolveOverlayValue,
  resolveBadgeColors,
  getBadgeColors,
  createBadgeSvg,
  createStyledBadgeSvg,
  calculatePosition,
  compositeOverlays,
  type OverlayPosition,
  type OverlayType,
  type Badge,
  type BadgeStyle,
  type BadgeShape,
  type ColorPreset,
  type FontSize,
  type ConditionalRule,
  type MediaInfo,
  type Ratings,
} from "@tinkerbell/overlays";

const overlayConfigRowSchema = z.object({
  id: z.number(),
  sectionId: z.string(),
  position: overlayPositionSchema,
  overlayType: overlayTypeSchema,
  order: z.number(),
  style: z
    .string()
    .nullable()
    .transform((s) => (s ? safeParseJson(s, badgeStyleSchema) : null)),
  rule: z
    .string()
    .nullable()
    .transform((s) => (s ? safeParseJson(s, conditionalRuleSchema) : null)),
  createdAt: z.number(),
});
export type OverlayConfigRow = z.infer<typeof overlayConfigRowSchema>;

function safeParseJson<T>(text: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseOverlayRows(rows: unknown[]): OverlayConfigRow[] {
  const out: OverlayConfigRow[] = [];
  for (const r of rows) {
    const parsed = overlayConfigRowSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
    else console.warn("[overlays] dropping invalid overlayConfigs row:", parsed.error.message);
  }
  return out;
}

/** Conditional rule evaluation. Returns true if the badge should be shown. */
export function evaluateRule(
  rule: ConditionalRule | null | undefined,
  type: OverlayType,
  value: string | null,
  ratings: { imdbRating?: string | null; rtRating?: string | null },
): boolean {
  if (rule?.hideIfMissing && value == null) return false;
  if (value == null) return true; // Allow renderer's downstream null-handling for non-strict cases.
  if (!rule) return true;
  if (rule.minImdb !== undefined && type === "imdb_rating") {
    const num = ratings.imdbRating ? parseFloat(ratings.imdbRating) : NaN;
    if (Number.isNaN(num) || num < rule.minImdb) return false;
  }
  if (rule.minRt !== undefined && type === "rt_rating") {
    const num = ratings.rtRating ? parseInt(String(ratings.rtRating).replace("%", ""), 10) : NaN;
    if (Number.isNaN(num) || num < rule.minRt) return false;
  }
  if (rule.onlyResolutions && type === "resolution") {
    if (!rule.onlyResolutions.includes(value)) return false;
  }
  return true;
}

/* ─── Presets ────────────────────────────────────────────────────────────── */

export const presetDataSchema = z.object({
  configs: z.array(
    z.object({
      position: overlayPositionSchema,
      overlayType: overlayTypeSchema,
      style: badgeStyleSchema.nullable().optional(),
      rule: conditionalRuleSchema.nullable().optional(),
      order: z.number().optional(),
    }),
  ),
});
export type PresetData = z.infer<typeof presetDataSchema>;

export interface OverlayPresetRow {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  data: PresetData;
  createdAt: number;
}

const BUILT_IN_PRESETS: Array<{ id: string; name: string; description: string; data: PresetData }> = [
  {
    id: "builtin_plex_native",
    name: "Plex Native",
    description: "Resolution top-left, IMDb top-right — clean and minimal",
    data: {
      configs: [
        { position: "top-left", overlayType: "resolution" },
        { position: "top-right", overlayType: "imdb_rating" },
      ],
    },
  },
  {
    id: "builtin_minimal_mono",
    name: "Minimal Mono",
    description: "Monochrome dark badges, small font",
    data: {
      configs: [
        {
          position: "top-left",
          overlayType: "resolution",
          style: { colorPreset: "dark", fontSize: "sm", shape: "pill" },
        },
        {
          position: "top-right",
          overlayType: "hdr",
          style: { colorPreset: "dark", fontSize: "sm", shape: "pill" },
        },
        {
          position: "bottom-right",
          overlayType: "audio_codec",
          style: { colorPreset: "dark", fontSize: "sm", shape: "pill" },
        },
      ],
    },
  },
  {
    id: "builtin_cinema",
    name: "Cinema",
    description: "Bold gold quality badges and ratings",
    data: {
      configs: [
        {
          position: "top-left",
          overlayType: "resolution",
          style: { colorPreset: "plex", fontSize: "lg", shape: "tag" },
        },
        {
          position: "top-left",
          overlayType: "hdr",
          style: { colorPreset: "purple", fontSize: "md", shape: "tag" },
        },
        {
          position: "top-right",
          overlayType: "imdb_rating",
          style: { colorPreset: "imdb", fontSize: "lg" },
          rule: { minImdb: 7.0 },
        },
        {
          position: "top-right",
          overlayType: "rt_rating",
          style: { colorPreset: "rt", fontSize: "md" },
          rule: { minRt: 75 },
        },
        {
          position: "bottom-right",
          overlayType: "audio_codec",
          style: { colorPreset: "dark", fontSize: "md", shape: "pill", opacity: 0.85 },
        },
      ],
    },
  },
  {
    id: "builtin_streaming",
    name: "Streaming Service",
    description: "Compact pill badges across the bottom",
    data: {
      configs: [
        {
          position: "bottom-left",
          overlayType: "resolution",
          style: { colorPreset: "blue", fontSize: "sm", shape: "pill" },
        },
        {
          position: "bottom-left",
          overlayType: "audio_channels",
          style: { colorPreset: "dark", fontSize: "sm", shape: "pill", opacity: 0.85 },
        },
        {
          position: "bottom-right",
          overlayType: "video_codec",
          style: { colorPreset: "dark", fontSize: "sm", shape: "pill", opacity: 0.85 },
        },
      ],
    },
  },
];

export interface OverlaysDeps {
  db: Db;
  recordChange: ChangeRecorder;
}
export function createOverlays(deps: OverlaysDeps) {
  const { db, recordChange } = deps;

  /** Whether any library has an overlay configured — what the overlays job needs to do anything. */
  function hasAnyOverlayConfig(): boolean {
    return db.select({ id: overlayConfigs.id }).from(overlayConfigs).limit(1).get() !== undefined;
  }

  function getOverlayConfigs(sectionId: string): OverlayConfigRow[] {
    const rows = db.select().from(overlayConfigs).where(eq(overlayConfigs.sectionId, sectionId)).all();
    return parseOverlayRows(rows).sort((a, b) => {
      if (a.position !== b.position) return a.position.localeCompare(b.position);
      return a.order - b.order;
    });
  }

  function getOverlayConfig(id: number): OverlayConfigRow | null {
    const row = db.select().from(overlayConfigs).where(eq(overlayConfigs.id, id)).get();
    if (!row) return null;
    const parsed = overlayConfigRowSchema.safeParse(row);
    return parsed.success ? parsed.data : null;
  }

  /** Add a new overlay at the end of its position stack. Returns the inserted row. */
  function addOverlayConfig(input: {
    sectionId: string;
    position: OverlayPosition;
    overlayType: OverlayType;
    style?: BadgeStyle | null;
    rule?: ConditionalRule | null;
  }): OverlayConfigRow {
    const existing = db
      .select({ maxOrder: max(overlayConfigs.order) })
      .from(overlayConfigs)
      .where(and(eq(overlayConfigs.sectionId, input.sectionId), eq(overlayConfigs.position, input.position)))
      .get();
    const nextOrder = (existing?.maxOrder ?? -1) + 1;

    const inserted = db
      .insert(overlayConfigs)
      .values({
        sectionId: input.sectionId,
        position: input.position,
        overlayType: input.overlayType,
        order: nextOrder,
        style: input.style ? JSON.stringify(input.style) : null,
        rule: input.rule ? JSON.stringify(input.rule) : null,
        createdAt: Date.now(),
      })
      .returning()
      .get();

    const parsed = overlayConfigRowSchema.parse(inserted);
    return parsed;
  }

  function updateOverlayConfig(
    id: number,
    patch: { style?: BadgeStyle | null; rule?: ConditionalRule | null; overlayType?: OverlayType },
  ): void {
    const set: Record<string, unknown> = {};
    if (patch.style !== undefined) set.style = patch.style ? JSON.stringify(patch.style) : null;
    if (patch.rule !== undefined) set.rule = patch.rule ? JSON.stringify(patch.rule) : null;
    if (patch.overlayType !== undefined) set.overlayType = patch.overlayType;
    if (Object.keys(set).length === 0) return;
    db.update(overlayConfigs).set(set).where(eq(overlayConfigs.id, id)).run();
  }

  function removeOverlayConfigById(id: number): void {
    db.delete(overlayConfigs).where(eq(overlayConfigs.id, id)).run();
  }

  /**
   * Move an overlay to a different position+order. Re-numbers within the
   * target stack.
   *
   * The negative-tmp dance below is safe against concurrent reorders because
   * `db.transaction` (better-sqlite3) is synchronous and SQLite serialises
   * writers: a second reorder cannot interleave with the first. Within a
   * single transaction the tmp orders never collide because they're assigned
   * sequentially.
   */
  function moveOverlayConfig(id: number, targetPosition: OverlayPosition, targetOrder: number): void {
    const row = getOverlayConfig(id);
    if (!row) return;
    db.transaction((tx) => {
      // Take all rows in target position (excluding the one being moved).
      const targetRows = tx
        .select()
        .from(overlayConfigs)
        .where(and(eq(overlayConfigs.sectionId, row.sectionId), eq(overlayConfigs.position, targetPosition)))
        .all()
        .filter((r) => r.id !== id)
        .sort((a, b) => a.order - b.order);

      // Insert moved row at targetOrder.
      const newOrderList = [...targetRows];
      const clampedTarget = Math.min(Math.max(0, targetOrder), newOrderList.length);
      newOrderList.splice(clampedTarget, 0, { id, order: -1 } as never);

      // Sort rows in source position too.
      const sourceRows =
        row.position === targetPosition
          ? []
          : tx
              .select()
              .from(overlayConfigs)
              .where(and(eq(overlayConfigs.sectionId, row.sectionId), eq(overlayConfigs.position, row.position)))
              .all()
              .filter((r) => r.id !== id)
              .sort((a, b) => a.order - b.order);

      // Strategy: temporarily set all touched rows to negative order to dodge unique index, then renumber.
      const touched = [...newOrderList.map((r) => r.id), ...sourceRows.map((r) => r.id)];
      let tmp = -1;
      for (const tid of touched) {
        tx.update(overlayConfigs)
          .set({ order: tmp-- })
          .where(eq(overlayConfigs.id, tid as number))
          .run();
      }

      // Apply final ordering for target.
      newOrderList.forEach((r, i) => {
        tx.update(overlayConfigs)
          .set({ order: i, position: targetPosition })
          .where(eq(overlayConfigs.id, r.id as number))
          .run();
      });
      sourceRows.forEach((r, i) => {
        tx.update(overlayConfigs)
          .set({ order: i })
          .where(eq(overlayConfigs.id, r.id as number))
          .run();
      });
    });
  }

  /** Reorder overlays within a single position. ids should list all overlays in that position in their new order. */
  function reorderOverlayConfigs(sectionId: string, position: OverlayPosition, ids: number[]): void {
    db.transaction((tx) => {
      let tmp = -1;
      for (const id of ids) {
        tx.update(overlayConfigs)
          .set({ order: tmp-- })
          .where(and(eq(overlayConfigs.id, id), eq(overlayConfigs.sectionId, sectionId)))
          .run();
      }
      ids.forEach((id, i) => {
        tx.update(overlayConfigs)
          .set({ order: i, position })
          .where(and(eq(overlayConfigs.id, id), eq(overlayConfigs.sectionId, sectionId)))
          .run();
      });
    });
  }

  function clearOverlayConfigs(sectionId: string) {
    db.delete(overlayConfigs).where(eq(overlayConfigs.sectionId, sectionId)).run();
  }

  /** Replace all overlays for a section atomically (used for preset apply). */
  function replaceOverlayConfigs(
    sectionId: string,
    configs: Array<{
      position: OverlayPosition;
      overlayType: OverlayType;
      style?: BadgeStyle | null;
      rule?: ConditionalRule | null;
      order?: number;
    }>,
  ): void {
    db.transaction((tx) => {
      tx.delete(overlayConfigs).where(eq(overlayConfigs.sectionId, sectionId)).run();
      // Group by position and assign sequential orders if not given.
      const byPos = new Map<OverlayPosition, typeof configs>();
      for (const c of configs) {
        const list = byPos.get(c.position) ?? [];
        list.push(c);
        byPos.set(c.position, list);
      }
      const now = Date.now();
      for (const [position, list] of byPos) {
        list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        list.forEach((c, i) => {
          tx.insert(overlayConfigs)
            .values({
              sectionId,
              position,
              overlayType: c.overlayType,
              order: i,
              style: c.style ? JSON.stringify(c.style) : null,
              rule: c.rule ? JSON.stringify(c.rule) : null,
              createdAt: now,
            })
            .run();
        });
      }
    });
  }

  function getOriginalPoster(ratingKey: string) {
    return db.select().from(overlayOriginals).where(eq(overlayOriginals.ratingKey, ratingKey)).get();
  }

  function saveOriginalPoster(ratingKey: string, sectionId: string, originalPosterUrl: string) {
    db.insert(overlayOriginals)
      .values({ ratingKey, sectionId, originalPosterUrl, appliedAt: Date.now() })
      .onConflictDoNothing()
      .run();
  }

  function removeOriginalPoster(ratingKey: string) {
    db.delete(overlayOriginals).where(eq(overlayOriginals.ratingKey, ratingKey)).run();
  }

  function getOverlaidItems(sectionId: string) {
    return db.select().from(overlayOriginals).where(eq(overlayOriginals.sectionId, sectionId)).all();
  }

  function getOverlaidItemCount(sectionId: string): number {
    const rows = db.select().from(overlayOriginals).where(eq(overlayOriginals.sectionId, sectionId)).all();
    return rows.length;
  }

  /**
   * A preset as the history should show it.
   *
   * `data` is stored as a JSON string, so a raw row would diff as one enormous
   * changed value every time somebody nudged a font size. Parsed here so the
   * diff lands on the field that moved. An unparseable row falls back to the
   * raw text rather than being dropped — a preset corrupt enough to fail the
   * schema is precisely one whose history is worth having.
   */
  function presetSnapshot(row: { name: string; description: string; data: string }): unknown {
    const parsed = presetDataSchema.safeParse(JSON.parse(row.data));
    return { name: row.name, description: row.description, data: parsed.success ? parsed.data : row.data };
  }

  function listPresets(): OverlayPresetRow[] {
    const rows = db.select().from(overlayPresets).all();
    return rows
      .map((r) => {
        const parsed = presetDataSchema.safeParse(JSON.parse(r.data));
        if (!parsed.success) return null;
        return {
          id: r.id,
          name: r.name,
          description: r.description,
          builtIn: r.builtIn === 1,
          data: parsed.data,
          createdAt: r.createdAt,
        };
      })
      .filter((r): r is OverlayPresetRow => r !== null)
      .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name));
  }

  function savePreset(input: { id?: string; name: string; description?: string; data: PresetData }): string {
    const id = input.id || `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Read first: this is an upsert, so "did it exist" is the only thing that
    // distinguishes a create from an edit, and after the write it is too late
    // to ask.
    const before = db.select().from(overlayPresets).where(eq(overlayPresets.id, id)).get();
    db.insert(overlayPresets)
      .values({
        id,
        name: input.name,
        description: input.description || "",
        builtIn: 0,
        data: JSON.stringify(input.data),
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: overlayPresets.id,
        set: { name: input.name, description: input.description || "", data: JSON.stringify(input.data) },
      })
      .run();
    recordChange({
      entity: "overlay_preset",
      entityId: id,
      action: before ? "update" : "create",
      before: before ? presetSnapshot(before) : undefined,
      after: { name: input.name, description: input.description || "", data: input.data },
    });
    return id;
  }

  function deletePreset(id: string): void {
    // Don't delete built-ins.
    const row = db.select().from(overlayPresets).where(eq(overlayPresets.id, id)).get();
    if (!row || row.builtIn === 1) return;
    db.delete(overlayPresets).where(eq(overlayPresets.id, id)).run();
    recordChange({ entity: "overlay_preset", entityId: id, action: "delete", before: presetSnapshot(row) });
  }

  function ensureBuiltInPresets(): void {
    for (const p of BUILT_IN_PRESETS) {
      const existing = db.select().from(overlayPresets).where(eq(overlayPresets.id, p.id)).get();
      if (existing) {
        // Refresh data so updates ship via app version.
        db.update(overlayPresets)
          .set({
            name: p.name,
            description: p.description,
            builtIn: 1,
            data: JSON.stringify(p.data),
          })
          .where(eq(overlayPresets.id, p.id))
          .run();
      } else {
        db.insert(overlayPresets)
          .values({
            id: p.id,
            name: p.name,
            description: p.description,
            builtIn: 1,
            data: JSON.stringify(p.data),
            createdAt: Date.now(),
          })
          .run();
      }
    }
  }

  return {
    getOverlayConfigs,
    hasAnyOverlayConfig,
    getOverlayConfig,
    addOverlayConfig,
    updateOverlayConfig,
    removeOverlayConfigById,
    moveOverlayConfig,
    reorderOverlayConfigs,
    clearOverlayConfigs,
    replaceOverlayConfigs,
    getOriginalPoster,
    saveOriginalPoster,
    removeOriginalPoster,
    getOverlaidItems,
    getOverlaidItemCount,
    listPresets,
    savePreset,
    deletePreset,
    ensureBuiltInPresets,
  };
}

export type Overlays = ReturnType<typeof createOverlays>;

export const OverlaysToken = token<Overlays>("overlays");

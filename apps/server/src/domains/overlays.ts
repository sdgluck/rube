import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, overlayConfigs, overlayOriginals } from "@tinkerbell/db";
import { overlayPositionSchema, overlayTypeSchema, type OverlayPosition, type OverlayType } from "@tinkerbell/overlays";

export {
  overlayPositionSchema,
  overlayTypeSchema,
  OVERLAY_POSITIONS,
  OVERLAY_TYPES,
  resolveOverlayValue,
  getBadgeColors,
  createBadgeSvg,
  calculatePosition,
  compositeOverlays,
  type OverlayPosition,
  type OverlayType,
  type Badge,
  type MediaInfo,
  type Ratings,
} from "@tinkerbell/overlays";

const overlayConfigRowSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  position: overlayPositionSchema,
  overlayType: overlayTypeSchema,
  createdAt: z.number(),
});
export type OverlayConfigRow = z.infer<typeof overlayConfigRowSchema>;

function parseOverlayRows(rows: unknown[]): OverlayConfigRow[] {
  const out: OverlayConfigRow[] = [];
  for (const r of rows) {
    const parsed = overlayConfigRowSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
    else console.warn("[overlays] dropping invalid overlayConfigs row:", parsed.error.message);
  }
  return out;
}

export function getOverlayConfigs(sectionId: string): OverlayConfigRow[] {
  const rows = db.select().from(overlayConfigs).where(eq(overlayConfigs.sectionId, sectionId)).all();
  return parseOverlayRows(rows);
}

export function setOverlayConfig(sectionId: string, position: OverlayPosition, overlayType: OverlayType) {
  const id = `${sectionId}:${position}`;
  db.insert(overlayConfigs)
    .values({ id, sectionId, position, overlayType, createdAt: Date.now() })
    .onConflictDoUpdate({
      target: overlayConfigs.id,
      set: { overlayType, createdAt: Date.now() },
    })
    .run();
}

export function removeOverlayConfig(sectionId: string, position: OverlayPosition) {
  const id = `${sectionId}:${position}`;
  db.delete(overlayConfigs).where(eq(overlayConfigs.id, id)).run();
}

export function clearOverlayConfigs(sectionId: string) {
  db.delete(overlayConfigs).where(eq(overlayConfigs.sectionId, sectionId)).run();
}

export function getOriginalPoster(ratingKey: string) {
  return db.select().from(overlayOriginals).where(eq(overlayOriginals.ratingKey, ratingKey)).get();
}

export function saveOriginalPoster(ratingKey: string, sectionId: string, originalPosterUrl: string) {
  db.insert(overlayOriginals)
    .values({ ratingKey, sectionId, originalPosterUrl, appliedAt: Date.now() })
    .onConflictDoNothing()
    .run();
}

export function removeOriginalPoster(ratingKey: string) {
  db.delete(overlayOriginals).where(eq(overlayOriginals.ratingKey, ratingKey)).run();
}

export function getOverlaidItems(sectionId: string) {
  return db.select().from(overlayOriginals).where(eq(overlayOriginals.sectionId, sectionId)).all();
}

export function getOverlaidItemCount(sectionId: string): number {
  const rows = db.select().from(overlayOriginals).where(eq(overlayOriginals.sectionId, sectionId)).all();
  return rows.length;
}

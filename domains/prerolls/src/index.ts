/**
 * Prerolls domain — the videos Plex plays before a movie starts.
 *
 * Rube owns the files (under `PREROLLS_DIR`) and the metadata; Plex owns
 * a single string preference pointing at them. Everything here is either
 * CRUD over that metadata or reconciling the two.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { prerolls, type Db } from "@rube/db";
import type { ChangeRecorder } from "@rube/ports";
import { prerollsDir, prerollsIncomingDir, prerollsThumbsDir, type ConfigStore, type Clients } from "@rube/core";
import { ffmpegVersion } from "@rube/video";
import { buildPrefValue, prefsMatch, type PrerollMode } from "./pref.ts";
import { token } from "@rube/container";
import { createAdopt } from "./adopt.ts";
import { resolvePortalPrerollCard, type PortalPrerollCard } from "@rube/contracts";
import type { PortalCardContent } from "./portal-card.ts";

export { buildPrefValue, joinPlexPath, prefsMatch, MODE_SEPARATORS } from "./pref.ts";
export type { PrerollMode } from "./pref.ts";
export {
  ALLOWED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  UnsupportedFormatError,
  UploadTooLargeError,
  assertSupportedFilename,
  downloadIncoming,
  filenameFromUrl,
  writeIncoming,
} from "./ingest.ts";
export { OrphanNotFoundError } from "./adopt.ts";
export {
  buildPortalCardSvg,
  displayUrl,
  renderPortalCardPng,
  writePortalCardThumb,
  CARD_HEIGHT,
  CARD_WIDTH,
} from "./portal-card.ts";
export type { PortalCardContent } from "./portal-card.ts";
export type { OrphanFile } from "./adopt.ts";

export type PrerollStatus = "pending" | "processing" | "ready" | "failed";
export type PrerollKind = "upload" | "portal";

/** Default name for the card's row; the admin can rename it like any other. */
const PORTAL_PREROLL_NAME = "Customise your Plex";

export class PortalUrlMissingError extends Error {
  constructor() {
    super("The portal preroll needs an address to show. Set one in Settings → Portal → Preroll.");
    this.name = "PortalUrlMissingError";
  }
}

const HEX = /^#[0-9a-f]{6}$/i;

export type Preroll = typeof prerolls.$inferSelect;

const DEFAULT_MAX_HEIGHT = 1080;

/** Ensure the three directories exist. Cheap enough to call on every write path. */
export async function ensurePrerollDirs(): Promise<void> {
  await mkdir(prerollsIncomingDir(), { recursive: true });
  await mkdir(prerollsThumbsDir(), { recursive: true });
}

// ── File locations ──────────────────────────────────────────────────────────

export function processedPath(id: string): string {
  return join(prerollsDir(), `${id}.mp4`);
}

export function thumbPath(id: string): string {
  return join(prerollsThumbsDir(), `${id}.jpg`);
}

export function incomingPath(id: string, ext: string): string {
  return join(prerollsIncomingDir(), `${id}${ext}`);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export type CreatePrerollInput = {
  name: string;
  originalFilename: string;
  sourceUrl?: string;
  kind?: PrerollKind;
};

export type ProcessedMetadata = {
  filename: string;
  sizeBytes: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  container: string;
  transcodeAction: string;
  transcodeReasons: string[];
};

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

export type PrerollSyncStatus = {
  expected: string;
  actual: string;
  inSync: boolean;
};

// ── Environment ─────────────────────────────────────────────────────────────

export type PrerollEnvironment = {
  ffmpeg: string | null;
  dir: string;
  dirWritable: boolean;
  plexPath: string;
  mode: PrerollMode;
  maxHeight: number;
};

export interface PrerollsDeps {
  db: Db;
  config: ConfigStore;
  clients: Clients;
  recordChange: ChangeRecorder;
}
export function createPrerolls(deps: PrerollsDeps) {
  const { db, recordChange } = deps;
  const { getConfig } = deps.config;
  const { getPlexClient } = deps.clients;

  function getMode(): PrerollMode {
    return getConfig("prerolls_mode") ?? "random";
  }

  function getMaxHeight(): number {
    return getConfig("prerolls_max_height") ?? DEFAULT_MAX_HEIGHT;
  }

  function getPlexPath(): string {
    // Defaults to the container path the Docker image ships with, which is
    // right for anyone following the documented compose setup.
    return getConfig("prerolls_plex_path") ?? "/prerolls";
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  function listPrerolls(): Preroll[] {
    return db.select().from(prerolls).orderBy(asc(prerolls.position), asc(prerolls.createdAt)).all();
  }

  function getPreroll(id: string): Preroll | undefined {
    return db.select().from(prerolls).where(eq(prerolls.id, id)).get();
  }

  function listPending(): Preroll[] {
    return db.select().from(prerolls).where(eq(prerolls.status, "pending")).orderBy(asc(prerolls.createdAt)).all();
  }

  /** Enabled + successfully processed, in playback order. */
  function listPlayable(): Preroll[] {
    return db
      .select()
      .from(prerolls)
      .where(and(eq(prerolls.enabled, 1), eq(prerolls.status, "ready")))
      .orderBy(asc(prerolls.position), asc(prerolls.createdAt))
      .all();
  }

  /**
   * Insert a `pending` row and return it. Called *before* bytes are written so
   * the upload has an id to name its temp file after, and so a failed upload
   * leaves a visible failed row rather than a silent nothing.
   */
  function createPreroll(input: CreatePrerollInput): Preroll {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      name: input.name.trim() || input.originalFilename,
      originalFilename: input.originalFilename,
      sourceUrl: input.sourceUrl ?? null,
      kind: input.kind ?? "upload",
      position: nextPosition(),
      createdAt: now,
      updatedAt: now,
    };
    db.insert(prerolls).values(row).run();
    const created = getPreroll(row.id)!;
    recordChange({ entity: "preroll", entityId: row.id, action: "create", after: prerollSnapshot(created) });
    return created;
  }

  /**
   * The half of a preroll row a person chose.
   *
   * `status`, `error` and the probed metadata are the processing job's, and it
   * rewrites them several times per upload — a history built from whole rows
   * would be mostly the encoder talking to itself.
   */
  function prerollSnapshot(row: Preroll): unknown {
    return { name: row.name, enabled: row.enabled, position: row.position, originalFilename: row.originalFilename };
  }

  function nextPosition(): number {
    const rows = db.select({ position: prerolls.position }).from(prerolls).all();
    return rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
  }

  function updatePreroll(id: string, patch: { name?: string; enabled?: boolean }): void {
    const before = getPreroll(id);
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.enabled !== undefined) set.enabled = patch.enabled ? 1 : 0;
    db.update(prerolls).set(set).where(eq(prerolls.id, id)).run();
    const after = getPreroll(id);
    if (!before || !after) return;
    recordChange({
      entity: "preroll",
      entityId: id,
      action: "update",
      before: prerollSnapshot(before),
      after: prerollSnapshot(after),
    });
  }

  function setStatus(id: string, status: PrerollStatus, error = ""): void {
    db.update(prerolls).set({ status, error, updatedAt: Date.now() }).where(eq(prerolls.id, id)).run();
  }

  function markReady(id: string, meta: ProcessedMetadata): void {
    db.update(prerolls)
      .set({ ...meta, status: "ready", error: "", updatedAt: Date.now() })
      .where(eq(prerolls.id, id))
      .run();
  }

  /**
   * Reorder to exactly the given sequence. Ids not in the list keep their
   * relative order after those that are, so a partial list from a stale client
   * can't silently drop rows out of the ordering.
   */
  function reorderPrerolls(orderedIds: string[]): void {
    db.transaction((tx) => {
      const all = tx.select({ id: prerolls.id }).from(prerolls).orderBy(asc(prerolls.position)).all();
      const seen = new Set(orderedIds);
      const finalOrder = [
        ...orderedIds.filter((id) => all.some((r) => r.id === id)),
        ...all.filter((r) => !seen.has(r.id)).map((r) => r.id),
      ];
      finalOrder.forEach((id, index) => {
        tx.update(prerolls).set({ position: index, updatedAt: Date.now() }).where(eq(prerolls.id, id)).run();
      });
    });
  }

  /**
   * Delete the row and every file it owns. Missing files are not an error.
   * Returns whether a row was actually removed, so callers can report a count
   * that reflects reality rather than what was asked for.
   */
  async function deletePreroll(id: string): Promise<boolean> {
    const row = getPreroll(id);
    if (!row) return false;
    db.delete(prerolls).where(eq(prerolls.id, id)).run();
    recordChange({ entity: "preroll", entityId: id, action: "delete", before: prerollSnapshot(row) });
    await Promise.all([
      rm(processedPath(id), { force: true }),
      rm(thumbPath(id), { force: true }),
      rm(incomingPath(id, extensionOf(row.originalFilename)), { force: true }),
    ]);
    return true;
  }

  async function deletePrerolls(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (await deletePreroll(id)) deleted++;
    }
    return deleted;
  }

  /** Requeue a failed row so the processing job picks it up again. */
  function retryPreroll(id: string): void {
    db.update(prerolls).set({ status: "pending", error: "", updatedAt: Date.now() }).where(eq(prerolls.id, id)).run();
  }

  // ── Plex reconciliation ─────────────────────────────────────────────────────

  /** The value we want `CinemaTrailersPrerollID` to hold right now. */
  function expectedPrefValue(): string {
    return buildPrefValue(
      listPlayable().map((p) => p.filename),
      getPlexPath(),
      getMode(),
    );
  }

  /** Read-only drift check, used by the page banner and the health check. */
  async function getPlexPrerollStatus(): Promise<PrerollSyncStatus> {
    const expected = expectedPrefValue();
    const actual = await getPlexClient().getPrerollPref();
    return { expected, actual, inSync: prefsMatch(expected, actual) };
  }

  /**
   * Write the preference and read it back. The read-back matters: Plex accepts
   * a PUT for an unknown or unwritable preference without complaint, so a
   * blind write tells you nothing about whether it took.
   */
  async function syncToPlex(): Promise<PrerollSyncStatus> {
    const client = getPlexClient();
    const expected = expectedPrefValue();
    await client.setPrerollPref(expected);
    const actual = await client.getPrerollPref();
    return { expected, actual, inSync: prefsMatch(expected, actual) };
  }

  /** Everything the Settings page needs to explain why the feature isn't working. */
  async function getEnvironment(): Promise<PrerollEnvironment> {
    const dir = prerollsDir();
    let dirWritable = false;
    try {
      await ensurePrerollDirs();
      const info = await stat(dir);
      dirWritable = info.isDirectory();
    } catch {
      // Left false — the UI turns this into "not writable", which is the only
      // thing the admin can act on regardless of the underlying errno.
    }
    return {
      ffmpeg: await ffmpegVersion(),
      dir,
      dirWritable,
      plexPath: getPlexPath(),
      mode: getMode(),
      maxHeight: getMaxHeight(),
    };
  }

  // ── The portal card ─────────────────────────────────────────────────────────

  function getPortalPreroll(): Preroll | undefined {
    return db.select().from(prerolls).where(eq(prerolls.kind, "portal")).get();
  }

  /**
   * Everything the renderer needs, from the stored card or — for the Settings
   * preview — an unsaved one.
   *
   * The address falls back to `user_app_public_url` because that is already
   * the portal's public address for Plex sign-in; asking for it twice would
   * let the two drift. Colours are re-checked here although the write path
   * validates them: they are interpolated into SVG, and a row that predates
   * validation shouldn't get to put markup there.
   */
  function portalCardContent(card: PortalPrerollCard | undefined = getConfig("portal_preroll")): PortalCardContent {
    const resolved = resolvePortalPrerollCard(card);
    const fallback = resolvePortalPrerollCard(undefined);
    const colour = (value: string, def: string) => (HEX.test(value) ? value : def);
    return {
      url: resolved.url.trim() || (getConfig("user_app_public_url") ?? "").trim(),
      headline: resolved.headline,
      message: resolved.message,
      eyebrow: getConfig("portal_branding")?.title,
      background: colour(resolved.background, fallback.background),
      foreground: colour(resolved.foreground, fallback.foreground),
      accent: colour(resolved.accent, fallback.accent),
      showQr: resolved.showQr,
    };
  }

  function portalCardDurationMs(): number {
    return resolvePortalPrerollCard(getConfig("portal_preroll")).durationSeconds * 1000;
  }

  /**
   * Put the card in the pool, or re-render the one already there.
   *
   * Re-rendering goes through the ordinary `pending` → processing path, so
   * the job, its progress, its failure reporting and the Plex sync after it
   * are the same ones an upload gets. The row keeps its id, position, name
   * and enabled flag — editing the text shouldn't reshuffle anybody's order.
   */
  function queuePortalPreroll(): Preroll {
    if (!portalCardContent().url) throw new PortalUrlMissingError();
    const existing = getPortalPreroll();
    if (existing) {
      retryPreroll(existing.id);
      return getPreroll(existing.id)!;
    }
    return createPreroll({ name: PORTAL_PREROLL_NAME, originalFilename: "portal-card.png", kind: "portal" });
  }

  /** Take the card out. Returns whether there was one. */
  async function removePortalPreroll(): Promise<boolean> {
    const row = getPortalPreroll();
    return row ? deletePreroll(row.id) : false;
  }

  /** Ids that are mid-flight, so the UI knows to keep polling. */
  function hasWorkInFlight(): boolean {
    const rows = db
      .select({ id: prerolls.id })
      .from(prerolls)
      .where(inArray(prerolls.status, ["pending", "processing"]))
      .all();
    return rows.length > 0;
  }

  const self = {
    getMode,
    getMaxHeight,
    getPlexPath,
    listPrerolls,
    getPreroll,
    listPending,
    listPlayable,
    createPreroll,
    updatePreroll,
    setStatus,
    markReady,
    reorderPrerolls,
    deletePreroll,
    deletePrerolls,
    retryPreroll,
    expectedPrefValue,
    getPlexPrerollStatus,
    syncToPlex,
    getEnvironment,
    hasWorkInFlight,
    getPortalPreroll,
    portalCardContent,
    portalCardDurationMs,
    queuePortalPreroll,
    removePortalPreroll,
  };

  // `adopt` walks the incoming directory and turns stray files into prerolls,
  // which means calling this factory's own `createPreroll`/`deletePreroll`.
  // Layered on afterwards rather than built alongside, because it consumes the
  // very object it contributes to.
  return { ...self, ...createAdopt({ prerolls: self }) };
}

export type Prerolls = ReturnType<typeof createPrerolls>;

export const PrerollsToken = token<Prerolls>("prerolls");

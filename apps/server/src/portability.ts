/**
 * Export, import and backup download — the three routes that can't be tRPC
 * procedures.
 *
 * Export and backup download want `Content-Disposition`, so the browser saves a
 * named file instead of the SPA juggling a blob and inventing a filename.
 * Import takes a whole bundle as its body, which the batch link would carry as
 * a JSON string inside a JSON envelope — doubling a document that already
 * contains a base64 portal background.
 *
 * Every route here is gated by the caller (`rejectIfNotAdmin` in `server.ts`)
 * for the obvious reason: export hands over the configuration, and import
 * replaces it.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { createLogger, errorMessage } from "@tinkerbell/core";
import type { Services } from "@tinkerbell/composition";
import { BUNDLE_PARTS, IMPORT_RESOLUTIONS, type BundlePart, type ImportResolution } from "@tinkerbell/contracts";
import { backupPath, listBackups, type BackupFile } from "@tinkerbell/domain.backups";

const log = createLogger("portability");

/** Enough for any bundle; a portal background is capped at 8 MB on its own. */
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

const EXPORT_PATH = "/api/portability/export";
const PREVIEW_PATH = "/api/portability/import/preview";
const APPLY_PATH = "/api/portability/import/apply";
const BACKUP_RE = /^\/api\/backups\/([^/]+)$/;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

/**
 * Read a JSON body, refusing one that is too large.
 *
 * The cap is enforced as bytes arrive rather than after `Content-Length`,
 * because a chunked request has no length to check and a hostile one would
 * happily stream until the process ran out of memory.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BUNDLE_BYTES) throw new Error("That file is too large to be a Tinkerbell bundle.");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw new Error("The request had no body.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
}

/** `?parts=rules,jobs` → the validated subset. Absent means everything. */
function partsFrom(url: URL): BundlePart[] {
  const raw = url.searchParams.get("parts");
  if (!raw) return [...BUNDLE_PARTS];
  const wanted = new Set(raw.split(",").map((p) => p.trim()));
  return BUNDLE_PARTS.filter((p) => wanted.has(p));
}

function decisionsFrom(value: unknown): Record<string, ImportResolution> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, ImportResolution> = {};
  for (const [key, resolution] of Object.entries(value as Record<string, unknown>)) {
    // An unrecognised resolution is dropped rather than coerced. The default
    // for a missing decision is `skip`, so dropping it is the safe direction —
    // coercing to "overwrite" on a typo would not be.
    if (IMPORT_RESOLUTIONS.includes(resolution as ImportResolution)) {
      out[key] = resolution as ImportResolution;
    }
  }
  return out;
}

export function createPortabilityRoutes(deps: Services & { version: string }) {
  const { exportBundle, previewImport, applyImport } = deps.portability;
  const { getPlexClient } = deps.clients;

  /**
   * This server's machine identifier, for the `server` block on an export.
   *
   * Best-effort: it exists so the import side can say "this is your own
   * backup" rather than "this is someone else's config", and an export must
   * not fail because Plex was unreachable at the moment somebody tried to get
   * their rules out — which is disproportionately when they try.
   */
  async function serverIdentity(): Promise<{ machineId: string; friendlyName: string } | undefined> {
    try {
      const { machineIdentifier } = await getPlexClient().getIdentity();
      return { machineId: machineIdentifier, friendlyName: deps.config.getConfig("global_plex_url") ?? "" };
    } catch {
      return undefined;
    }
  }

  async function handleExport(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method !== "GET") return json(res, 405, { error: "Use GET" });

    const includeSecrets = url.searchParams.get("includeSecrets") === "1";
    const { bundle, warnings } = await exportBundle({
      parts: partsFrom(url),
      includeSecrets,
      server: await serverIdentity(),
      tinkerbellVersion: deps.version,
    });

    if (warnings.length > 0) {
      log.warn("some tag values could not be made portable", { count: warnings.length });
    }

    // The date is in the filename because the first thing anybody does with
    // these is accumulate several in a downloads folder.
    const stamp = new Date(bundle.exportedAt).toISOString().slice(0, 10);
    const name = `tinkerbell-${stamp}${includeSecrets ? "-with-secrets" : ""}.json`;
    const payload = JSON.stringify(bundle, null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": Buffer.byteLength(payload),
      // A configuration export is the last thing that should sit in a proxy.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(payload);
  }

  async function handlePreview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
    const body = await readJsonBody(req);
    const identity = await serverIdentity();
    json(res, 200, await previewImport(body, identity?.machineId));
  }

  async function handleApply(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") return json(res, 405, { error: "Use POST" });
    const body = (await readJsonBody(req)) as { bundle?: unknown; decisions?: unknown };
    if (!body || typeof body !== "object" || body.bundle === undefined) {
      return json(res, 400, { error: "Expected { bundle, decisions }." });
    }
    const identity = await serverIdentity();
    const summary = await applyImport(body.bundle, decisionsFrom(body.decisions), {
      localMachineId: identity?.machineId,
    });
    json(res, 200, summary);
  }

  /**
   * Serve one backup file.
   *
   * The name is matched against the directory listing rather than joined onto
   * a path: `listBackups` is the authority on what exists, so a caller cannot
   * traverse out of the backup directory by asking for one whose name contains
   * `..` — an unlisted name simply isn't found.
   */
  async function handleBackupDownload(res: ServerResponse, name: string): Promise<void> {
    const known = (await listBackups(deps.config)).find((b: BackupFile) => b.name === name);
    if (!known) return json(res, 404, { error: "No such backup." });

    const path = backupPath(deps.config, known.name);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return json(res, 404, { error: "That backup is listed but its file is gone." });
    }

    res.writeHead(200, {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${known.name}"`,
      "Content-Length": size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    await pipeline(createReadStream(path), res);
  }

  /** Returns false when the path isn't ours, so the caller falls through. */
  async function handlePortabilityRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    try {
      if (path === EXPORT_PATH) {
        await handleExport(req, res, url);
        return true;
      }
      if (path === PREVIEW_PATH) {
        await handlePreview(req, res);
        return true;
      }
      if (path === APPLY_PATH) {
        await handleApply(req, res);
        return true;
      }
      const backup = path.match(BACKUP_RE);
      if (backup) {
        if (req.method !== "GET") {
          json(res, 405, { error: "Use GET" });
          return true;
        }
        await handleBackupDownload(res, decodeURIComponent(backup[1]));
        return true;
      }
      return false;
    } catch (err) {
      // A bad bundle is the user's file, not a server fault: 400, with the
      // message the domain wrote, which names the version needed or the field
      // that failed. A 500 here would send somebody looking at logs for a
      // problem that is visible in the file they just picked.
      if (!res.headersSent) json(res, 400, { error: errorMessage(err) });
      else res.end();
      return true;
    }
  }

  return { handlePortabilityRoute };
}

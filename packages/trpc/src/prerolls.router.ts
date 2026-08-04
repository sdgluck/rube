import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { createLogger, errorMessage, setConfig } from "@tinkerbell/core";
import { startJob } from "@tinkerbell/jobs";
import { UnsafeUrlError } from "@tinkerbell/http";
import {
  UnsupportedFormatError,
  UploadTooLargeError,
  assertSupportedFilename,
  createPreroll,
  deletePreroll,
  deletePrerolls,
  downloadIncoming,
  ensurePrerollDirs,
  expectedPrefValue,
  filenameFromUrl,
  getEnvironment,
  getPlexPrerollStatus,
  getPreroll,
  listPrerolls,
  reorderPrerolls,
  retryPreroll,
  syncToPlex,
  updatePreroll,
} from "@tinkerbell/domain.prerolls";
import { getPlexClient, procedure, t } from "./_base.ts";

/**
 * Kick the processing job, tolerating "already running".
 *
 * Sidequest runs one job at a time and the command drains every pending row,
 * so a second upload arriving mid-run is already covered by the run in
 * flight — a CONFLICT here would be a lie to the user.
 */
const log = createLogger("prerolls");

async function triggerProcessing(): Promise<void> {
  try {
    const result = await startJob("preroll-process");
    if (!result.ok && result.reason === "not-found") {
      log.error("preroll-process job is missing — uploaded files will stay pending");
    }
  } catch (err) {
    // The throw is swallowed deliberately: the files are on disk and `pending`,
    // so the next successful trigger picks them up regardless. Log it, though —
    // silence here is what made a broken queue invisible.
    log.warn("failed to trigger preroll processing", { err: errorMessage(err) });
  }
}

/** Plex failures are upstream failures — surface them as such, with the reason. */
function plexError(err: unknown): TRPCError {
  return new TRPCError({ code: "BAD_GATEWAY", message: `Plex rejected the request: ${errorMessage(err)}` });
}

export const prerollsRouter = t.router({
  list: procedure.query(() => listPrerolls()),

  get: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const row = getPreroll(input.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That preroll no longer exists" });
    return row;
  }),

  update: procedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(200).optional(), enabled: z.boolean().optional() }))
    .mutation(({ input }) => {
      if (!getPreroll(input.id)) throw new TRPCError({ code: "NOT_FOUND", message: "That preroll no longer exists" });
      updatePreroll(input.id, { name: input.name, enabled: input.enabled });
      return { ok: true as const };
    }),

  reorder: procedure.input(z.object({ ids: z.array(z.string()) })).mutation(({ input }) => {
    reorderPrerolls(input.ids);
    return { ok: true as const };
  }),

  delete: procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    return { deleted: await deletePreroll(input.id) };
  }),

  deleteMany: procedure.input(z.object({ ids: z.array(z.string()).min(1) })).mutation(async ({ input }) => {
    return { deleted: await deletePrerolls(input.ids) };
  }),

  retry: procedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const row = getPreroll(input.id);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That preroll no longer exists" });
    retryPreroll(input.id);
    await triggerProcessing();
    return { ok: true as const };
  }),

  /**
   * Pull a preroll from a URL. Downloads synchronously so the user gets an
   * immediate, specific error (bad URL, wrong format, too big) rather than a
   * row that fails silently in the background a minute later.
   */
  importFromUrl: procedure
    .input(z.object({ url: z.string().url(), name: z.string().max(200).optional() }))
    .mutation(async ({ input }) => {
      const filename = filenameFromUrl(input.url) || "download.mp4";
      let ext: string;
      try {
        ext = assertSupportedFilename(filename);
      } catch (err) {
        if (err instanceof UnsupportedFormatError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${err.message}. The URL must point directly at a video file.`,
          });
        }
        throw err;
      }

      await ensurePrerollDirs();
      const row = createPreroll({
        name: input.name?.trim() || filename,
        originalFilename: filename,
        sourceUrl: input.url,
      });

      try {
        await downloadIncoming(row.id, input.url, ext);
      } catch (err) {
        await deletePreroll(row.id);
        if (err instanceof UnsafeUrlError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That address isn't reachable from Tinkerbell" });
        }
        if (err instanceof UploadTooLargeError) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: err.message });
        }
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Couldn't download that file: ${errorMessage(err)}` });
      }

      await triggerProcessing();
      return { id: row.id };
    }),

  /** Push the current pool into Plex's preference and report whether it stuck. */
  sync: procedure.mutation(async () => {
    try {
      return await syncToPlex();
    } catch (err) {
      throw plexError(err);
    }
  }),

  /** Read-only drift check for the page's sync bar. */
  plexStatus: procedure.query(async () => {
    try {
      return await getPlexPrerollStatus();
    } catch (err) {
      // Not an error the page should blow up over — Plex being unreachable is
      // a state the sync bar renders, not a reason to lose the whole list.
      return { expected: expectedPrefValue(), actual: "", inSync: false, error: errorMessage(err) };
    }
  }),

  environment: procedure.query(() => getEnvironment()),

  setMode: procedure.input(z.object({ mode: z.enum(["random", "sequential"]) })).mutation(({ input }) => {
    setConfig("prerolls_mode", input.mode);
    return { ok: true as const };
  }),

  /**
   * Write a throwaway path, read it back, then restore what was there.
   *
   * The point is to prove Plex accepts writes to this preference at all
   * before the admin discovers otherwise mid-movie. It cannot prove the path
   * resolves on Plex's filesystem — nothing over the API can.
   */
  verifyPlexPath: procedure.mutation(async () => {
    const client = getPlexClient();
    const probeValue = `/__tinkerbell_probe_${randomUUID()}.mp4`;
    try {
      const before = await client.getPrerollPref();
      await client.setPrerollPref(probeValue);
      const readBack = await client.getPrerollPref();
      await client.setPrerollPref(before);
      return {
        writable: readBack.trim() === probeValue,
        restored: before,
      };
    } catch (err) {
      throw plexError(err);
    }
  }),
});

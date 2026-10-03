import { ServicesToken, type Services } from "@tinkerbell/composition";
import { rm, stat, writeFile } from "node:fs/promises";
import { errorMessage } from "@tinkerbell/core";
import type { CommonJobConfig, JobContext } from "@tinkerbell/core";
import {
  FfmpegError,
  applyAction,
  decide,
  encodeStill,
  ffmpegVersion,
  generateThumbnail,
  probe,
} from "@tinkerbell/video";
import {
  ensurePrerollDirs,
  extensionOf,
  incomingPath,
  processedPath,
  PortalUrlMissingError,
  renderPortalCardPng,
  writePortalCardThumb,
  thumbPath,
  type Preroll,
  type ProcessedMetadata,
} from "@tinkerbell/domain.prerolls";

export function createPrerollProcessCommand(deps: Pick<Services, "prerolls">) {
  const { prerolls } = deps;
  const {
    getMaxHeight,
    getPreroll,
    listPending,
    markReady,
    portalCardContent,
    portalCardDurationMs,
    setStatus,
    syncToPlex,
  } = prerolls;

  /**
   * Probe every freshly-uploaded preroll, normalise it if Plex wouldn't direct
   * play it, and push the resulting path list into Plex's preference.
   *
   * Runs on demand — the upload route and the URL import both trigger it. There
   * is no schedule; there's nothing to do until someone adds a file.
   */
  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    ctx.log("tinkerbell preroll-process");

    const version = await ffmpegVersion();
    if (!version) {
      throw new Error("ffmpeg is not installed or not on PATH. Prerolls cannot be processed without it.");
    }
    ctx.log(`ffmpeg ${version}`);

    await ensurePrerollDirs();

    const pending = listPending();
    if (pending.length === 0) {
      ctx.log("No prerolls waiting to be processed.");
      return;
    }

    ctx.log(`${pending.length} preroll(s) to process`);

    let succeeded = 0;
    let failed = 0;

    for (const [index, row] of pending.entries()) {
      if (ctx.signal.aborted) {
        ctx.log("Cancelled — remaining prerolls stay pending.");
        break;
      }

      // Each file contributes an equal slice of the bar, and ffmpeg's own
      // progress fills that slice — so a single long encode still animates.
      const slice = (fraction: number) =>
        ctx.progress(index + fraction, pending.length, `${row.name} — ${Math.round(fraction * 100)}%`);

      try {
        await processOne(ctx, row, slice);
        succeeded++;
      } catch (err) {
        if (ctx.signal.aborted) {
          // Cancellation isn't a failure: leave the row pending so a later run
          // picks it up rather than making the admin click Retry.
          ctx.log("Cancelled mid-encode — leaving this preroll pending.");
          setStatus(row.id, "pending");
          break;
        }
        failed++;
        const detail = err instanceof FfmpegError && err.stderr ? `${err.message}\n${err.stderr}` : errorMessage(err);
        ctx.log(`✗ ${row.name}: ${detail}`);
        setStatus(row.id, "failed", detail);
      }
      ctx.progress(index + 1, pending.length, `${index + 1}/${pending.length} processed`);
    }

    ctx.log(`Processed ${succeeded} preroll(s)${failed > 0 ? `, ${failed} failed` : ""}.`);

    if (succeeded === 0) return;

    // Only worth touching Plex if the playable set can actually have changed.
    try {
      const status = await syncToPlex();
      if (status.inSync) {
        ctx.log(`Plex pre-roll preference updated: ${status.expected || "(cleared)"}`);
      } else {
        ctx.log(
          `⚠ Plex did not accept the pre-roll preference. Wanted "${status.expected}", server reports "${status.actual}".`,
        );
      }
    } catch (err) {
      // A Plex outage shouldn't fail a run whose real work — transcoding —
      // succeeded. The files are on disk; the sync bar will offer a retry.
      ctx.log(`⚠ Could not update Plex: ${errorMessage(err)}`);
    }
  }

  async function processOne(ctx: JobContext, row: Preroll, onProgress: (fraction: number) => void): Promise<void> {
    setStatus(row.id, "processing");
    if (row.kind === "portal") return renderPortal(ctx, row, onProgress);

    const source = incomingPath(row.id, extensionOf(row.originalFilename));
    const output = processedPath(row.id);

    let info;
    try {
      info = await probe(source, ctx.signal);
    } catch (err) {
      // A missing incoming file means the upload died halfway. Say so plainly
      // rather than surfacing ffprobe's "No such file or directory".
      const exists = await stat(source).then(
        () => true,
        () => false,
      );
      if (!exists)
        throw new Error(
          "The uploaded file is missing — the upload probably didn't finish. Delete this preroll and try again.",
        );
      throw err;
    }

    const maxHeight = getMaxHeight();
    const { action, reasons } = decide(info, { maxHeight });
    ctx.log(
      `${row.name}: ${info.container} ${info.video?.codec ?? "no video"} ${info.video?.height ?? 0}p → ${action}`,
    );
    for (const reason of reasons) ctx.log(`  · ${reason}`);

    await applyAction(action, source, output, {
      maxHeight,
      sourceFps: info.video?.fps,
      durationMs: info.durationMs,
      signal: ctx.signal,
      onProgress,
    });

    try {
      await generateThumbnail(output, thumbPath(row.id), { durationMs: info.durationMs, signal: ctx.signal });
    } catch (err) {
      // A missing poster frame is cosmetic — the preroll still plays.
      ctx.log(`  · Couldn't generate a thumbnail: ${errorMessage(err)}`);
    }

    // Re-probe the output rather than reporting the source's numbers: after an
    // encode the resolution, codecs and size are all different, and those are
    // exactly what the UI shows.
    const final = action === "copy" ? info : await probe(output, ctx.signal).catch(() => info);
    const size = await stat(output).then(
      (s) => s.size,
      () => final.sizeBytes,
    );

    markReady(row.id, {
      filename: `${row.id}.mp4`,
      sizeBytes: size,
      durationMs: final.durationMs,
      width: final.video?.width ?? 0,
      height: final.video?.height ?? 0,
      fps: final.video?.fps ?? 0,
      videoCodec: final.video?.codec ?? "",
      audioCodec: final.audio?.codec ?? "",
      container: "mp4",
      transcodeAction: action,
      transcodeReasons: reasons,
    });

    // `copy` renames the incoming file into place, so there's nothing left to
    // clean up in that case. Remux and encode both leave the original behind.
    if (action !== "copy") {
      await rm(source, { force: true });
    }
  }

  /**
   * The portal card has no upload to probe: draw the frame, hold it for the
   * configured length, and record it like any other ready preroll.
   *
   * The card is read at render time, not when the row was queued. Saving in
   * Settings mid-encode requeues the row (`pending`) underneath this run, and
   * the run already in flight is the one that covers it — so the encode is
   * repeated until the card it drew is still the current one, rather than
   * `markReady` stamping a stale frame as done.
   */
  async function renderPortal(ctx: JobContext, row: Preroll, onProgress: (fraction: number) => void): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const meta = await renderPortalOnce(ctx, row, onProgress);
      // No await between this read and `markReady`, so a save can't land in
      // between. Bounded, so somebody hammering Save can't pin the job here.
      const requeued = getPreroll(row.id)?.status === "pending";
      if (!requeued || attempt >= 2) {
        markReady(row.id, meta);
        return;
      }
      ctx.log(`${row.name}: the card changed while rendering — rendering again`);
      setStatus(row.id, "processing");
    }
  }

  async function renderPortalOnce(
    ctx: JobContext,
    row: Preroll,
    onProgress: (fraction: number) => void,
  ): Promise<ProcessedMetadata> {
    const content = portalCardContent();
    if (!content.url) throw new PortalUrlMissingError();
    const durationMs = portalCardDurationMs();
    const maxHeight = getMaxHeight();
    ctx.log(`${row.name}: rendering the portal card for ${content.url}`);

    // Staged where an upload's source would be, so `deletePreroll` already
    // knows to clean it up (the row's `originalFilename` is a .png).
    const frame = incomingPath(row.id, ".png");
    const output = processedPath(row.id);
    try {
      const png = await renderPortalCardPng(content);
      await writeFile(frame, png);
      await encodeStill(frame, output, { durationMs, maxHeight, signal: ctx.signal, onProgress });
      await writePortalCardThumb(png, thumbPath(row.id));
    } finally {
      await rm(frame, { force: true });
    }

    const final = await probe(output, ctx.signal);
    const size = await stat(output).then(
      (s) => s.size,
      () => final.sizeBytes,
    );
    return {
      filename: `${row.id}.mp4`,
      sizeBytes: size,
      durationMs: final.durationMs,
      width: final.video?.width ?? 0,
      height: final.video?.height ?? 0,
      fps: final.video?.fps ?? 0,
      videoCodec: final.video?.codec ?? "",
      audioCodec: final.audio?.codec ?? "",
      container: "mp4",
      transcodeAction: "render",
      transcodeReasons: [`Points viewers at ${content.url}`],
    };
  }

  return { run };
}

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createPrerollProcessCommand>["run"]>[1],
): Promise<void> {
  return createPrerollProcessCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}

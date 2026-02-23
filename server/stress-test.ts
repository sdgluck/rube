import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "./db/index.ts";
import { stressTestRuns } from "./db/schema.ts";
import { createPlexClient } from "./plex.ts";
import type { PlexClient } from "./plex.ts";
import { getConfig } from "./config.ts";
import type { JobContext } from "../shared/job-context.ts";

export interface StressTestConfig {
  mode: "transcode" | "directplay" | "mixed";
  transcodePct?: number;
  maxSessions?: number;
}

export interface StressTestStep {
  step: number;
  sessions: number;
  avgTranscodeSpeed: number | null;
  avgBandwidth: number;
  errors: number;
  timestamp: number;
}

export interface StressTestResult {
  config: StressTestConfig;
  maxSessions: number;
  steps: StressTestStep[];
  startedAt: number;
  finishedAt: number;
}

const CLIENT_PREFIX = "tinkerbell-stress-";

class SimulatedClient {
  readonly clientId: string;
  readonly sessionId: string;
  private controller = new AbortController();
  private mode: "transcode" | "directplay" = "transcode";
  private running = false;
  private ratingKey = "";
  private duration = 0;
  private timelineTimer: ReturnType<typeof setInterval> | null = null;
  private playbackTime = 0;
  log: ((msg: string) => void) | null = null;

  constructor() {
    this.clientId = CLIENT_PREFIX + randomUUID().slice(0, 8);
    this.sessionId = randomUUID();
  }

  async start(ratingKey: string, mode: "transcode" | "directplay", client: PlexClient): Promise<void> {
    this.mode = mode;
    this.ratingKey = ratingKey;
    this.running = true;

    // Get item duration for timeline reports
    const detail = await client.getItemDetail(ratingKey);
    this.duration = detail.duration || 7200000; // fallback 2hrs

    if (mode === "transcode") {
      await this.startTranscode(ratingKey, client);
    } else {
      await this.startDirectPlay(ratingKey, client);
    }

    // Report initial "playing" state
    await client.reportTimeline(ratingKey, this.clientId, {
      state: "playing",
      time: 0,
      duration: this.duration,
    });

    // Periodically report timeline to keep session alive
    this.timelineTimer = setInterval(async () => {
      if (!this.running) return;
      this.playbackTime += 10000;
      try {
        await client.reportTimeline(this.ratingKey, this.clientId, {
          state: "playing",
          time: this.playbackTime,
          duration: this.duration,
        });
      } catch {
        // Best-effort
      }
    }, 10000);
  }

  private async startTranscode(ratingKey: string, client: PlexClient): Promise<void> {
    const masterM3u8 = await client.startTranscodeSession(ratingKey, this.sessionId, this.clientId);

    this.log?.(`  M3U8 response (${masterM3u8.length} chars): ${masterM3u8.substring(0, 300)}`);

    // The response could be a master playlist (with variant streams) or a media playlist (with segments)
    const lines = masterM3u8
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Check if this is a master playlist (contains #EXT-X-STREAM-INF)
    const isMaster = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"));

    let mediaPlaylistUrl: string;

    if (isMaster) {
      // Find the first variant stream URL (line after #EXT-X-STREAM-INF)
      const variantUrl = lines.find(
        (l, i) => i > 0 && lines[i - 1].startsWith("#EXT-X-STREAM-INF") && !l.startsWith("#"),
      );
      if (!variantUrl) {
        throw new Error("Master playlist has no variant stream URLs");
      }
      this.log?.(`  Following variant playlist: ${variantUrl}`);
      mediaPlaylistUrl = variantUrl;
    } else {
      throw new Error("Expected master playlist but got media playlist directly");
    }

    // Continuously poll the live media playlist and fetch new segments
    void this.hlsLoop(mediaPlaylistUrl, client);
  }

  private async startDirectPlay(ratingKey: string, client: PlexClient): Promise<void> {
    const detail = await client.getItemDetail(ratingKey);
    const partKey = detail.media?.[0]?.parts?.[0]?.file;
    if (!partKey) {
      throw new Error(`No playable part found for item ${ratingKey}`);
    }
    const partUrl = `/library/metadata/${ratingKey}/file`;
    // For direct play, just keep fetching the file in a loop
    void this.hlsLoop(partUrl, client, true);
  }

  /**
   * For HLS transcode: continuously poll the media playlist for new segments and fetch them.
   * For direct play: repeatedly fetch the file URL.
   */
  private async hlsLoop(playlistUrl: string, client: PlexClient, directPlay = false): Promise<void> {
    const signal = this.controller.signal;
    const fetchedSegments = new Set<string>();
    const playlistBase = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);

    while (this.running && !signal.aborted) {
      if (directPlay) {
        // Direct play: fetch chunks of the file
        try {
          const res = await client.fetchStreamUrl(playlistUrl, this.clientId, signal);
          const reader = res.body?.getReader();
          if (reader) {
            try {
              // Read for a few seconds then loop
              const deadline = Date.now() + 5000;
              while (this.running && !signal.aborted && Date.now() < deadline) {
                const { done } = await reader.read();
                if (done) break;
              }
            } finally {
              reader.releaseLock();
            }
          }
        } catch {
          if (signal.aborted) break;
        }
        await this.sleepAbortable(2000);
        continue;
      }

      // HLS: poll the media playlist for new segments
      try {
        const res = await client.fetchStreamUrl(playlistUrl, this.clientId, signal);
        const m3u8 = await res.text();
        const lines = m3u8
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const segments = lines
          .filter((l) => !l.startsWith("#"))
          .map((s) => (s.startsWith("/") || s.startsWith("http") ? s : playlistBase + s));

        // Fetch any new segments we haven't seen yet
        for (const segUrl of segments) {
          if (signal.aborted || !this.running) break;
          if (fetchedSegments.has(segUrl)) continue;
          fetchedSegments.add(segUrl);

          try {
            const segRes = await client.fetchStreamUrl(segUrl, this.clientId, signal);
            const reader = segRes.body?.getReader();
            if (reader) {
              try {
                while (this.running && !signal.aborted) {
                  const { done } = await reader.read();
                  if (done) break;
                }
              } finally {
                reader.releaseLock();
              }
            }
          } catch {
            if (signal.aborted) break;
          }
        }
      } catch {
        if (signal.aborted) break;
      }

      // Wait before polling the playlist again (HLS segments are typically 4-6s)
      await this.sleepAbortable(4000);
    }
  }

  private sleepAbortable(ms: number): Promise<void> {
    const signal = this.controller.signal;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  async stop(client: PlexClient): Promise<void> {
    this.running = false;
    if (this.timelineTimer) {
      clearInterval(this.timelineTimer);
      this.timelineTimer = null;
    }
    this.controller.abort();

    // Report "stopped" state
    try {
      await client.reportTimeline(this.ratingKey, this.clientId, {
        state: "stopped",
        time: this.playbackTime,
        duration: this.duration,
      });
    } catch {
      // Best-effort
    }

    if (this.mode === "transcode") {
      await client.stopTranscodeSession(this.sessionId);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runStressTest(
  client: PlexClient,
  config: StressTestConfig,
  ctx: JobContext,
  resultId?: string,
): Promise<StressTestResult> {
  const maxSessions = config.maxSessions ?? 20;
  const transcodePct = config.mode === "mixed" ? (config.transcodePct ?? 50) : config.mode === "transcode" ? 100 : 0;

  const startedAt = Date.now();
  const steps: StressTestStep[] = [];
  const clients: SimulatedClient[] = [];

  // Gather media items — movies can be used directly; shows need episode resolution
  ctx.log("Fetching library sections...");
  const sections = await client.getSections();
  const movieSections = sections.filter((s) => s.type === "movie");
  const showSections = sections.filter((s) => s.type === "show");

  if (movieSections.length === 0 && showSections.length === 0) {
    throw new Error("No movie or show sections found in Plex library");
  }

  // Collect a pool of ratingKeys (must be directly playable items: movies or episodes)
  // Skip items with existing watch progress to avoid polluting "Continue Watching"
  ctx.log("Gathering unwatched media items for test...");
  const ratingKeys: string[] = [];
  let skippedInProgress = 0;

  async function addIfUnwatched(ratingKey: string): Promise<boolean> {
    if (ratingKeys.length >= maxSessions * 2) return false;
    try {
      const detail = await client.getItemDetail(ratingKey);
      if (detail.viewOffset && detail.viewOffset > 0) {
        skippedInProgress++;
        return false;
      }
      ratingKeys.push(ratingKey);
      return true;
    } catch {
      return false;
    }
  }

  // Movies are directly playable
  for (const section of movieSections) {
    const result = await client.getItems(section.key, { offset: 0, size: 100 });
    for (const item of result.items) {
      await addIfUnwatched(item.ratingKey);
      if (ratingKeys.length >= maxSessions * 2) break;
    }
    if (ratingKeys.length >= maxSessions * 2) break;
  }

  // For shows, resolve to individual episodes
  if (ratingKeys.length < maxSessions * 2) {
    for (const section of showSections) {
      const result = await client.getItems(section.key, { offset: 0, size: 10 });
      for (const show of result.items) {
        if (ratingKeys.length >= maxSessions * 2) break;
        try {
          const seasons = await client.getMetadataChildren(show.ratingKey);
          if (seasons.length > 0) {
            const episodes = await client.getMetadataChildren(seasons[0].ratingKey);
            for (const ep of episodes.slice(0, 5)) {
              await addIfUnwatched(ep.ratingKey);
              if (ratingKeys.length >= maxSessions * 2) break;
            }
          }
        } catch {
          // Skip shows that fail metadata fetch
        }
      }
      if (ratingKeys.length >= maxSessions * 2) break;
    }
  }

  if (ratingKeys.length === 0) {
    throw new Error("No unwatched playable media items found in video sections");
  }

  if (skippedInProgress > 0) {
    ctx.log(`Skipped ${skippedInProgress} item(s) with existing watch progress`);
  }

  // Shuffle the pool
  for (let i = ratingKeys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ratingKeys[i], ratingKeys[j]] = [ratingKeys[j], ratingKeys[i]];
  }

  ctx.log(`Found ${ratingKeys.length} media items for testing`);
  ctx.log(`Mode: ${config.mode}, Max sessions: ${maxSessions}`);
  if (config.mode === "mixed") {
    ctx.log(`Transcode/DirectPlay ratio: ${transcodePct}/${100 - transcodePct}`);
  }

  let maxHealthySessions = 0;
  const usedRatingKeys = new Set<string>();

  try {
    for (let step = 1; step <= maxSessions; step++) {
      if (ctx.signal.aborted) break;

      // Determine mode for this client
      const useTranscode = Math.random() * 100 < transcodePct;
      const clientMode = useTranscode ? "transcode" : "directplay";

      const ratingKey = ratingKeys[(step - 1) % ratingKeys.length];
      const simClient = new SimulatedClient();
      // Wire up debug logging for first step
      if (step <= 2) {
        simClient.log = (msg) => ctx.log(msg);
      }

      ctx.log(`Step ${step}: Starting ${clientMode} session (${simClient.clientId})`);
      ctx.progress(step, maxSessions + 1, `Starting session ${step}/${maxSessions}`);

      try {
        await simClient.start(ratingKey, clientMode as "transcode" | "directplay", client);
        clients.push(simClient);
        usedRatingKeys.add(ratingKey);
      } catch (err) {
        ctx.log(`Step ${step}: Failed to start session: ${(err as Error).message}`);
        steps.push({
          step,
          sessions: clients.length,
          avgTranscodeSpeed: null,
          avgBandwidth: 0,
          errors: 1,
          timestamp: Date.now(),
        });
        break;
      }

      // Wait for stabilization
      ctx.log(`Step ${step}: Waiting 15s for stabilization...`);
      await sleep(15000, ctx.signal);
      if (ctx.signal.aborted) break;

      // Sample sessions 3 times over 6 seconds
      let totalSpeed = 0;
      let speedCount = 0;
      let totalBandwidth = 0;
      let bandwidthCount = 0;
      let errors = 0;

      for (let sample = 0; sample < 3; sample++) {
        if (ctx.signal.aborted) break;
        try {
          const sessions = await client.getActiveSessions();

          // Log session details on first sample of first step for debugging
          if (sample === 0 && step === 1) {
            ctx.log(`  Active sessions (${sessions.length} total):`);
            for (const s of sessions) {
              ctx.log(
                `    player="${s.player}" machineId="${s.playerMachineId}" product="${s.product}" speed=${s.transcodeSpeed} bw=${s.bandwidth}`,
              );
            }
          }

          // Filter to only our stress test clients by machineIdentifier
          const ourSessions = sessions.filter((s) => s.playerMachineId?.startsWith(CLIENT_PREFIX));

          if (sample === 0 && ourSessions.length === 0 && sessions.length > 0) {
            ctx.log(`  Warning: ${sessions.length} sessions found but none matched prefix "${CLIENT_PREFIX}"`);
          }

          for (const session of ourSessions) {
            // Only count non-zero speeds (0 means transcoder is still starting)
            if (session.transcodeSpeed != null && session.transcodeSpeed > 0) {
              totalSpeed += session.transcodeSpeed;
              speedCount++;
            }
            if (session.bandwidth != null) {
              totalBandwidth += session.bandwidth;
              bandwidthCount++;
            }
          }
        } catch {
          errors++;
        }

        if (sample < 2) await sleep(2000, ctx.signal);
      }

      const avgSpeed = speedCount > 0 ? totalSpeed / speedCount : null;
      const avgBandwidth = bandwidthCount > 0 ? totalBandwidth / bandwidthCount : 0;

      const stepResult: StressTestStep = {
        step,
        sessions: clients.length,
        avgTranscodeSpeed: avgSpeed != null ? Math.round(avgSpeed * 100) / 100 : null,
        avgBandwidth: Math.round(avgBandwidth),
        errors,
        timestamp: Date.now(),
      };
      steps.push(stepResult);

      ctx.log(
        `Step ${step}: ${clients.length} sessions, ` +
          `speed=${avgSpeed != null ? avgSpeed.toFixed(2) + "x" : "n/a"}, ` +
          `bandwidth=${avgBandwidth}kbps, errors=${errors}`,
      );

      // Check for degradation — only flag speed if we have actual readings (not null/startup)
      const speedDegraded = avgSpeed != null && avgSpeed < 1.0;
      const degraded = speedDegraded || errors > 0;
      if (degraded) {
        ctx.log(`Step ${step}: Degradation detected — stopping ramp-up`);
        // The previous step was the last healthy one
        break;
      }

      maxHealthySessions = clients.length;
    }
  } finally {
    // Cleanup all clients
    ctx.log(`Cleaning up ${clients.length} session(s)...`);
    ctx.progress(maxSessions, maxSessions + 1, "Cleaning up sessions...");
    await Promise.allSettled(clients.map((c) => c.stop(client)));

    // Mark all used media items as unwatched to clean up watch history
    if (usedRatingKeys.size > 0) {
      ctx.log(`Marking ${usedRatingKeys.size} item(s) as unwatched...`);
      for (const key of usedRatingKeys) {
        try {
          await client.markUnwatched(key);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  }

  const finishedAt = Date.now();
  const result: StressTestResult = {
    config,
    maxSessions: maxHealthySessions,
    steps,
    startedAt,
    finishedAt,
  };

  // Save to database
  const id = resultId || randomUUID();
  saveStressTestResult(id, result);

  ctx.log(`Stress test complete: max supported sessions = ${maxHealthySessions}`);
  ctx.progress(1, 1, `Complete: ${maxHealthySessions} sessions supported`);

  return result;
}

export function saveStressTestResult(id: string, result: StressTestResult): void {
  db.insert(stressTestRuns)
    .values({
      id,
      config: JSON.stringify(result.config),
      maxSessions: result.maxSessions,
      steps: JSON.stringify(result.steps),
      status: "completed",
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    })
    .onConflictDoUpdate({
      target: stressTestRuns.id,
      set: {
        config: JSON.stringify(result.config),
        maxSessions: result.maxSessions,
        steps: JSON.stringify(result.steps),
        status: "completed",
        finishedAt: result.finishedAt,
      },
    })
    .run();
}

export function getStressTestRuns(): Array<{
  id: string;
  config: StressTestConfig;
  maxSessions: number | null;
  status: string;
  startedAt: number;
  finishedAt: number | null;
}> {
  const rows = db
    .select({
      id: stressTestRuns.id,
      config: stressTestRuns.config,
      maxSessions: stressTestRuns.maxSessions,
      status: stressTestRuns.status,
      startedAt: stressTestRuns.startedAt,
      finishedAt: stressTestRuns.finishedAt,
    })
    .from(stressTestRuns)
    .orderBy(desc(stressTestRuns.startedAt))
    .all();

  return rows.map((r) => ({
    ...r,
    config: JSON.parse(r.config) as StressTestConfig,
  }));
}

export function getStressTestRun(id: string): {
  id: string;
  config: StressTestConfig;
  maxSessions: number | null;
  steps: StressTestStep[];
  startedAt: number;
  finishedAt: number | null;
} | null {
  const row = db.select().from(stressTestRuns).where(eq(stressTestRuns.id, id)).get();
  if (!row) return null;

  return {
    ...row,
    config: JSON.parse(row.config) as StressTestConfig,
    steps: JSON.parse(row.steps) as StressTestStep[],
  };
}

// --- In-process runner ---

let activeStressTest: { id: string; controller: AbortController } | null = null;

export function startStressTestInProcess(config: StressTestConfig): { id: string } {
  if (activeStressTest) {
    throw new Error("A stress test is already running");
  }

  const id = randomUUID();
  const controller = new AbortController();
  const now = Date.now();

  db.insert(stressTestRuns)
    .values({
      id,
      config: JSON.stringify(config),
      maxSessions: null,
      steps: "[]",
      status: "running",
      progress: 0,
      message: "",
      log: "",
      startedAt: now,
    })
    .run();

  activeStressTest = { id, controller };

  let logBuffer = "";
  let currentProgress = 0;
  let currentMessage = "";

  function flushToDb(): void {
    if (!logBuffer && currentProgress === 0) return;
    try {
      const currentRow = db
        .select({ log: stressTestRuns.log })
        .from(stressTestRuns)
        .where(eq(stressTestRuns.id, id))
        .get();
      const existingLog = currentRow?.log ?? "";
      db.update(stressTestRuns)
        .set({
          log: existingLog + logBuffer,
          progress: currentProgress,
          message: currentMessage,
        })
        .where(eq(stressTestRuns.id, id))
        .run();
      logBuffer = "";
    } catch {
      // DB may be closed during shutdown
    }
  }

  const flushTimer = setInterval(flushToDb, 500);

  const ctx: JobContext = {
    log: (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n";
      logBuffer += text;
      const trimmed = text.trim();
      if (trimmed) currentMessage = trimmed;
    },
    progress: (current: number, total: number, msg: string) => {
      currentProgress = total > 0 ? (current - 1) / total : 0;
      currentMessage = msg;
    },
    signal: controller.signal,
  };

  const plexUrl = getConfig("global_plex_url");
  const plexToken = getConfig("global_plex_token");
  if (!plexUrl || !plexToken) {
    clearInterval(flushTimer);
    activeStressTest = null;
    db.update(stressTestRuns)
      .set({ status: "failed", message: "Plex URL and token are not configured", finishedAt: Date.now() })
      .where(eq(stressTestRuns.id, id))
      .run();
    throw new Error("Plex URL and token are not configured");
  }

  const client = createPlexClient({ url: plexUrl, token: plexToken, signal: controller.signal });

  // Fire-and-forget
  runStressTest(client, config, ctx, id)
    .then(() => {
      clearInterval(flushTimer);
      flushToDb();
      db.update(stressTestRuns)
        .set({ status: "completed", progress: 1, finishedAt: Date.now() })
        .where(eq(stressTestRuns.id, id))
        .run();
    })
    .catch((err) => {
      clearInterval(flushTimer);
      logBuffer += `\nError: ${(err as Error).message}\n`;
      flushToDb();
      const status = controller.signal.aborted ? "cancelled" : "failed";
      db.update(stressTestRuns)
        .set({ status, message: (err as Error).message, finishedAt: Date.now() })
        .where(eq(stressTestRuns.id, id))
        .run();
    })
    .finally(() => {
      clearInterval(flushTimer);
      activeStressTest = null;
    });

  return { id };
}

export function cancelStressTest(): void {
  if (!activeStressTest) return;
  const { id, controller } = activeStressTest;
  controller.abort();
  db.update(stressTestRuns).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(stressTestRuns.id, id)).run();
  activeStressTest = null;
}

export function getActiveStressTest(): {
  id: string;
  progress: number;
  message: string;
  log: string;
  startedAt: number;
} | null {
  if (!activeStressTest) return null;
  const row = db
    .select({
      id: stressTestRuns.id,
      progress: stressTestRuns.progress,
      message: stressTestRuns.message,
      log: stressTestRuns.log,
      startedAt: stressTestRuns.startedAt,
    })
    .from(stressTestRuns)
    .where(eq(stressTestRuns.id, activeStressTest.id))
    .get();
  return row ?? null;
}

export function markStaleStressTestsAsFailed(): void {
  const result = db
    .update(stressTestRuns)
    .set({ status: "failed", finishedAt: Date.now() })
    .where(eq(stressTestRuns.status, "running"))
    .run();
  if (result.changes > 0) {
    console.log(`[stress-test] Marked ${result.changes} stale running stress test(s) as failed`);
  }
}

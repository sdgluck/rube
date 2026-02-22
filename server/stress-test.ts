import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { db } from "./db/index.ts";
import { stressTestRuns } from "./db/schema.ts";
import type { PlexClient } from "./plex.ts";
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
    let segmentUrls: string[] = [];

    // Check if this is a master playlist (contains #EXT-X-STREAM-INF)
    const isMaster = lines.some((l) => l.startsWith("#EXT-X-STREAM-INF"));

    if (isMaster) {
      // Find the first variant stream URL (line after #EXT-X-STREAM-INF)
      const variantUrl = lines.find(
        (l, i) => i > 0 && lines[i - 1].startsWith("#EXT-X-STREAM-INF") && !l.startsWith("#"),
      );
      if (variantUrl) {
        this.log?.(`  Following variant playlist: ${variantUrl}`);
        try {
          const variantRes = await client.fetchStreamUrl(variantUrl, this.clientId, this.controller.signal);
          const variantM3u8 = await variantRes.text();
          // Extract segment URLs from the media playlist
          const variantLines = variantM3u8
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          segmentUrls = variantLines.filter((l) => !l.startsWith("#"));

          // Segments may be relative to the variant playlist's path
          const variantBase = variantUrl.substring(0, variantUrl.lastIndexOf("/") + 1);
          segmentUrls = segmentUrls.map((s) => (s.startsWith("/") || s.startsWith("http") ? s : variantBase + s));
        } catch {
          // Fall through with empty segments
        }
      }
    } else {
      // Already a media playlist — extract segments directly
      segmentUrls = lines.filter((l) => !l.startsWith("#"));
    }

    if (segmentUrls.length === 0) {
      throw new Error("No segments found in transcode playlist");
    }

    this.log?.(`  Found ${segmentUrls.length} segments`);

    // Fetch segments in a loop to simulate playback
    void this.fetchLoop(segmentUrls, client);
  }

  private async startDirectPlay(ratingKey: string, client: PlexClient): Promise<void> {
    // Get the part key from item metadata for direct play streaming
    const detail = await client.getItemDetail(ratingKey);
    const partKey = detail.media?.[0]?.parts?.[0]?.file;
    if (!partKey) {
      throw new Error(`No playable part found for item ${ratingKey}`);
    }
    const partUrl = `/library/metadata/${ratingKey}/file`;
    void this.fetchLoop([partUrl], client);
  }

  private async fetchLoop(urls: string[], client: PlexClient): Promise<void> {
    const signal = this.controller.signal;
    let idx = 0;
    while (this.running && !signal.aborted) {
      const url = urls[idx % urls.length];
      try {
        const res = await client.fetchStreamUrl(url, this.clientId, signal);
        // Consume the body to keep the connection alive
        const reader = res.body?.getReader();
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
      idx++;
      // Small delay between segments to simulate real playback pacing
      if (this.running && !signal.aborted) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
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
    }
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
  ctx.log("Gathering media items for test...");
  const ratingKeys: string[] = [];

  // Movies are directly playable
  for (const section of movieSections) {
    const result = await client.getItems(section.key, { offset: 0, size: 50 });
    for (const item of result.items) {
      ratingKeys.push(item.ratingKey);
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
            for (const ep of episodes.slice(0, 3)) {
              ratingKeys.push(ep.ratingKey);
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
    throw new Error("No playable media items found in video sections");
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
            if (session.transcodeSpeed != null) {
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

      // Check for degradation
      const degraded = (avgSpeed != null && avgSpeed < 1.0) || errors > 0;
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
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
    })
    .onConflictDoUpdate({
      target: stressTestRuns.id,
      set: {
        config: JSON.stringify(result.config),
        maxSessions: result.maxSessions,
        steps: JSON.stringify(result.steps),
        finishedAt: result.finishedAt,
      },
    })
    .run();
}

export function getStressTestRuns(): Array<{
  id: string;
  config: StressTestConfig;
  maxSessions: number | null;
  startedAt: number;
  finishedAt: number | null;
}> {
  const rows = db
    .select({
      id: stressTestRuns.id,
      config: stressTestRuns.config,
      maxSessions: stressTestRuns.maxSessions,
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

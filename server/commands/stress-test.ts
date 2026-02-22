import { createPlexClient } from "../plex.ts";
import { getConfig } from "../config.ts";
import { runStressTest, type StressTestConfig } from "../stress-test.ts";
import type { JobContext, StressTestJobConfig } from "../../shared/job-context.ts";

export default async function run(ctx: JobContext, config: StressTestJobConfig): Promise<void> {
  const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
  const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

  if (!PLEX_TOKEN) {
    throw new Error("Plex token is required. Configure it in Settings.");
  }

  const client = createPlexClient({
    url: PLEX_URL,
    token: PLEX_TOKEN,
    signal: ctx.signal,
  });

  ctx.log("tinkerbell stress-test");
  ctx.log(`Server: ${PLEX_URL}`);

  const identity = await client.getIdentity();
  ctx.log(`Server name: ${identity.friendlyName}`);

  const testConfig: StressTestConfig = {
    mode: config.mode || "transcode",
    transcodePct: config.transcodePct,
    maxSessions: config.maxSessions,
  };

  const result = await runStressTest(client, testConfig, ctx);

  ctx.log(`\nResults:`);
  ctx.log(`  Mode: ${result.config.mode}`);
  ctx.log(`  Max supported sessions: ${result.maxSessions}`);
  ctx.log(`  Steps completed: ${result.steps.length}`);
  ctx.log(`  Duration: ${Math.round((result.finishedAt - result.startedAt) / 1000)}s`);
}

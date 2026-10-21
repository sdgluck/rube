/**
 * Boots the same isolated stack `capture.ts` uses (throwaway DB, mock Plex,
 * seeded demo data) and then just stays up, so a human or a browser agent can
 * click around it. Nothing here touches the repo-root rube.db or a real
 * Plex server.
 *
 * Usage: pnpm --filter @rube/rube.fyi serve
 */

import { spawn, type ChildProcess } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startMockPlex } from "./mock-plex.ts";
import { FIXED_NOW } from "./clock.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "../..");
const dataDir = resolve(appDir, ".harness-data");

const SERVER_PORT = 39_301;
const WEB_PORT = 39_302;
const MOCK_PORT = 39_303;

const children: ChildProcess[] = [];

function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
  });
}

function startProcess(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; tag: string }) {
  const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
  const echo = (buf: Buffer) => process.stdout.write(`[${opts.tag}] ${buf}`);
  p.stdout?.on("data", echo);
  p.stderr?.on("data", echo);
  children.push(p);
}

async function waitForHttp(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

// Same guard capture.ts uses: never seed over anything but the throwaway dir.
if (dataDir !== resolve(appDir, ".harness-data")) {
  throw new Error(`Refusing to run: DATA_DIR is ${dataDir}`);
}

await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

const childEnv = { DATA_DIR: dataDir, TB_FIXED_NOW: String(FIXED_NOW), TZ: "UTC" };
const preload = resolve(__dirname, "deterministic.mjs");

console.log("→ migrating isolated DB");
await run("pnpm", ["--filter", "@rube/db", "migrate"], { cwd: repoRoot, env: childEnv });

console.log("→ starting mock Plex");
const mock = await startMockPlex(MOCK_PORT);

console.log("→ seeding demo data");
await run("node", ["--import", preload, "--experimental-strip-types", "harness/seed.ts"], {
  cwd: appDir,
  env: { ...childEnv, MOCK_PLEX_URL: mock.origin },
});

console.log("→ starting server + web");
startProcess("node", ["--import", preload, "src/server.ts"], {
  cwd: resolve(repoRoot, "apps/server"),
  env: { ...childEnv, HOST: "127.0.0.1", PORT: String(SERVER_PORT), TB_DISABLE_SCHEDULER: "1" },
  tag: "server",
});
startProcess("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], {
  cwd: resolve(repoRoot, "apps/web"),
  env: { TB_API_TARGET: `http://127.0.0.1:${SERVER_PORT}` },
  tag: "web",
});

await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/trpc/plexSections`);
await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`);

console.log(`\n✓ harness up → http://127.0.0.1:${WEB_PORT}\n`);

const shutdown = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

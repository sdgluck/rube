/**
 * Screenshot capture orchestrator.
 *
 * Runs the REAL admin UI against synthetic data and a mock Plex server, then
 * drives a headless browser to capture each screen into public/screenshots.
 *
 * Pipeline:
 *   1. recreate an isolated DATA_DIR (never the repo-root tinkerbell.db)
 *   2. migrate that DB via the migrate script (per repo rule, never inline)
 *   3. start the in-process mock Plex (serves synthetic poster bytes)
 *   4. seed the DB (config → mock origin, sections, collections, media, …)
 *   5. start apps/server (:3000) + apps/web vite dev (:5173, proxies /api)
 *   6. Playwright navigates each shot and writes the PNG
 *   7. tear everything down
 *
 * Usage: pnpm --filter @tinkerbell/tinkerbell.dev capture
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { startMockPlex } from "./mock-plex.ts";
import { SHOTS } from "./shots.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "../..");
const dataDir = resolve(appDir, ".harness-data");
const outDir = resolve(appDir, "public/screenshots");

const SERVER_PORT = 3000;
const WEB_PORT = 5273; // off the default 5173 to avoid colliding with a dev vite
const MOCK_PORT = 32400;
const VIEWPORT = { width: 1440, height: 900 };

const children: ChildProcess[] = [];

function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
  return new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} → exit ${code}`))));
    p.on("error", rej);
  });
}

function startProcess(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; tag: string }) {
  const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } });
  children.push(p);
  p.stdout?.on("data", (d) => process.stdout.write(`[${opts.tag}] ${d}`));
  p.stderr?.on("data", (d) => process.stderr.write(`[${opts.tag}] ${d}`));
  return p;
}

/**
 * Refuse to run if a port we need is already taken. Without this, a real dev
 * stack already on :3000 would answer the server-readiness probe, and the
 * harness would silently screenshot the user's REAL Plex library onto a public
 * site. Fail loudly instead.
 */
function assertPortFree(port: number, label: string) {
  return new Promise<void>((res, rej) => {
    const probe = createNetServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        rej(
          new Error(
            `Port ${port} (${label}) is already in use. Refusing to run so the harness ` +
              `can't accidentally capture an already-running Tinkerbell with real data. ` +
              `Stop whatever is on :${port} (e.g. your dev stack) and retry.`,
          ),
        );
      } else {
        rej(err);
      }
    });
    probe.once("listening", () => probe.close(() => res()));
    probe.listen(port, "127.0.0.1");
  });
}

async function waitForHttp(url: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status === 404) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function teardown() {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 500));
}

async function main() {
  // 0. fail fast if any required port is taken (real-data leak guard)
  await assertPortFree(SERVER_PORT, "admin server");
  await assertPortFree(WEB_PORT, "web vite");
  await assertPortFree(MOCK_PORT, "mock Plex");

  // 1. isolate
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const childEnv = { DATA_DIR: dataDir };

  // 2. migrate the throwaway DB
  console.log("→ migrating isolated DB");
  await run("pnpm", ["--filter", "@tinkerbell/db", "migrate"], { cwd: repoRoot, env: childEnv });

  // 3. mock Plex (in-process so capture can serve poster bytes to the server)
  console.log("→ starting mock Plex");
  const mock = await startMockPlex(MOCK_PORT);

  // 4. seed
  console.log("→ seeding demo data");
  await run("node", ["--experimental-strip-types", "harness/seed.ts"], {
    cwd: appDir,
    env: { ...childEnv, MOCK_PLEX_URL: mock.origin },
  });

  // 5. start server + web
  console.log("→ starting server + web");
  startProcess("node", ["src/server.ts"], {
    cwd: resolve(repoRoot, "apps/server"),
    env: { ...childEnv, HOST: "127.0.0.1", PORT: String(SERVER_PORT) },
    tag: "server",
  });
  startProcess("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: resolve(repoRoot, "apps/web"),
    tag: "web",
  });

  await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/trpc/plexSections`);
  await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`);

  // 6. capture
  console.log("→ launching browser");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const base = `http://127.0.0.1:${WEB_PORT}`;

  for (const shot of SHOTS) {
    process.stdout.write(`  • ${shot.name} (${shot.path}) … `);
    await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle", timeout: 30_000 });
    if (shot.clickText) {
      await page
        .getByRole("button", { name: shot.clickText, exact: true })
        .click({ timeout: 5_000 })
        .catch(() => {});
    }
    if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(shot.settleMs ?? 600);
    // Settle late image loads (posters proxied through /api/plex-image).
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map((img) => new Promise((r) => img.addEventListener("load", r, { once: true }))),
      );
    });
    await page.screenshot({ path: resolve(outDir, `${shot.name}.png`), fullPage: shot.fullPage ?? false });
    console.log("ok");
  }

  await browser.close();
  await mock.close();
  console.log(`\n✓ captured ${SHOTS.length} screenshots → public/screenshots/`);
}

main()
  .then(teardown)
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("\n✗ capture failed:", err);
    await teardown();
    process.exit(1);
  });

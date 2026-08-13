/**
 * Screenshot capture orchestrator.
 *
 * Runs the REAL admin UI against synthetic data and a mock Plex server, then
 * drives a headless browser over every shot in shots.ts.
 *
 * Pipeline:
 *   1. recreate an isolated DATA_DIR (never the repo-root tinkerbell.db)
 *   2. start the in-process mock Plex (serves synthetic poster bytes)
 *   3. put a migrated, seeded database there — copied from the one the image
 *      prepared, or built here via the migrate script (per repo rule, never
 *      inline) when running natively
 *   4. start apps/server with a frozen clock; it serves the built admin UI
 *      itself, on the same origin as the API, exactly as production does
 *   5. Playwright walks the shots in parallel, one page per worker
 *   6. write only the files whose bytes actually changed, plus the manifest
 *
 * Two properties this file exists to protect:
 *
 *   No real data. The seeded config points Plex at a mock on localhost, and
 *   `assertHarnessData` refuses to run if DATA_DIR isn't the throwaway
 *   directory. The screenshots are committed and feed a public marketing site;
 *   a capture of someone's real library would put their friends' names and
 *   their server's hostname in git.
 *
 *   Byte-stability. An unchanged page must produce an identical PNG, or the
 *   commit hook that guards these files turns every UI edit into a 20MB diff.
 *   Hence the frozen clock, the seeded Math.random, disabled polling and
 *   animations, and a pinned colour profile.
 *
 * Usage: pnpm screenshots
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { cpus } from "node:os";
import { rm, mkdir, cp, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import sharp from "sharp";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { startMockPlex } from "./mock-plex.ts";
import { SHOTS, type Shot, type Step, type Viewport } from "./shots.ts";
import { FIXED_NOW } from "./clock.ts";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "../..");
const dataDir = resolve(appDir, ".harness-data");
const suiteDir = resolve(repoRoot, "screenshots");
const siteDir = resolve(appDir, "public/screenshots");

/**
 * High ports, so a capture can run while `pnpm dev` is up. The old harness sat
 * on the dev stack's own ports and refused to start if they were busy; with
 * screenshots now on the pre-commit path that would be constant friction.
 */
const SERVER_PORT = 39_301;
const MOCK_PORT = 39_303;

const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 430, height: 932 },
};

/** The marketing site's captures stay retina; the review suite is 1x. */
const SITE_SCALE = 2;

const children: ChildProcess[] = [];

/** Phase log with elapsed time, so a slow run says where it went. */
const started = Date.now();
const step = (message: string) => console.log(`→ ${message} (+${((Date.now() - started) / 1000).toFixed(1)}s)`);

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

function assertPortFree(port: number, label: string) {
  return new Promise<void>((res, rej) => {
    const probe = createNetServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      rej(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${port} (${label}) is in use. The harness uses high ports; stop whatever took it.`)
          : err,
      );
    });
    probe.once("listening", () => probe.close(() => res()));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * The real-data guard. Every child gets DATA_DIR pointed at the throwaway
 * directory; if that ever stopped being true the harness would seed, and then
 * capture, whatever real database it found instead.
 */
function assertHarnessData(dir: string) {
  if (dir !== dataDir) {
    throw new Error(`Refusing to run: DATA_DIR is ${dir}, not the throwaway ${dataDir}.`);
  }
  if (existsSync(join(repoRoot, "tinkerbell.db")) && dir.startsWith(repoRoot) && dir === repoRoot) {
    throw new Error("Refusing to run against the repo-root database.");
  }
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
    await new Promise((r) => setTimeout(r, 100));
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
  // Long enough for a SIGTERM to be delivered; the container is torn down right
  // behind us either way.
  await new Promise((r) => setTimeout(r, 100));
}

// ─── Browser setup ───────────────────────────────────────────────────────────

async function launch(): Promise<Browser> {
  return chromium.launch({
    args: [
      // Chromium colour-corrects to the display profile, so the same page gives
      // different RGB on a P3 laptop panel and an sRGB monitor.
      "--force-color-profile=srgb",
      // Subpixel antialiasing fringes differ with the compositor.
      "--disable-lcd-text",
      "--font-render-hinting=none",
      // Scrollbars are painted and take layout width, and differ per platform.
      "--hide-scrollbars",
      // Chromium's sandbox needs privileges a container doesn't have, and the
      // alternative is running the whole capture as root.
      ...(process.env.TB_CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
      // Pure CPU raster. With the GPU path in play, shadow gradients came back
      // a few pixels different between runs on the same machine.
      "--disable-gpu",
      "--disable-partial-raster",
      "--disable-skia-runtime-opts",
    ],
  });
}

async function newContext(browser: Browser, viewport: Viewport, scale: number): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: scale,
    isMobile: viewport === "mobile",
    hasTouch: viewport === "mobile",
    // The redesign is light-first; its dark theme is documented as a starting
    // point rather than a finished design, so capturing dark would publish
    // something nobody has drawn.
    colorScheme: "light",
    reducedMotion: "reduce",
    locale: "en-GB",
    timezoneId: "UTC",
  });

  // Preview shuffles hubs with Math.random; anything else that reaches for it
  // would drift too. Seeded PRNG, same sequence every run.
  await context.addInitScript(() => {
    let s = 0x2f6e2b1 >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });

  return context;
}

/**
 * Playwright's `networkidle` is 500ms of silence, and the harness waits for it
 * on each of ~100 loads — nearly a minute of work spent doing nothing. This is
 * the same idea with the window as an argument: long enough for react-query to
 * chain a dependent request off the response before it, short enough not to
 * dominate the run.
 *
 * Attach before navigating, or the requests the page fires on the way up are
 * never counted.
 */
const QUIET_MS = 150;

function watchNetwork(page: Page): (quietMs?: number) => Promise<void> {
  let inflight = 0;
  let lastChange = Date.now();
  const bump = (delta: number) => {
    inflight += delta;
    lastChange = Date.now();
  };
  page.on("request", () => bump(1));
  page.on("requestfinished", () => bump(-1));
  page.on("requestfailed", () => bump(-1));

  return async function quiet(quietMs = QUIET_MS, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (inflight <= 0 && Date.now() - lastChange >= quietMs) return;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for the network to go quiet (${inflight} pending)`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
}

// ─── Per-shot driving ────────────────────────────────────────────────────────

async function applySteps(page: Page, steps: Step[]) {
  // Steps drive a live app, so wait for React to have mounted and painted
  // before touching it. Locators auto-wait, but a keystroke doesn't: the
  // shortcut handlers are bound in effects, and a key pressed before they exist
  // is dropped with nothing to retry against.
  await page.waitForSelector("#root > *", { state: "attached", timeout: 15_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  for (const [index, step] of steps.entries()) {
    if ("click" in step) {
      // Buttons first, then anything else carrying the name — several controls
      // are labelled inputs rather than buttons. Whichever appears wins: asking
      // which one exists *now* assumed the page had finished rendering, and the
      // controls behind fetched data hadn't.
      const button = page.getByRole("button", { name: step.click, exact: false }).first();
      const labelled = page.getByLabel(step.click, { exact: false }).first();
      const target = await Promise.any([
        button.waitFor({ state: "visible", timeout: 10_000 }).then(() => button),
        labelled.waitFor({ state: "visible", timeout: 10_000 }).then(() => labelled),
      ]).catch(() => {
        throw new Error(`No button or labelled control named "${step.click}" appeared`);
      });
      await target.click({ timeout: 10_000 });
    } else if ("clickSelector" in step) {
      await page.locator(step.clickSelector).first().click({ timeout: 10_000 });
    } else if ("clickText" in step) {
      await page.getByText(step.clickText, { exact: false }).first().click({ timeout: 10_000 });
    } else if ("press" in step) {
      // A dropped keystroke leaves no trace, so when the shot says what the key
      // should produce, press again until it does — checking first, so a press
      // that did land isn't toggled straight back off. If it never appears the
      // following `wait` step reports it.
      const next = steps[index + 1];
      const expected = next && "wait" in next ? next.wait : undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.keyboard.press(step.press);
        if (!expected) break;
        const landed = await page
          .waitForSelector(expected, { state: "visible", timeout: 3_000 })
          .then(() => true)
          .catch(() => false);
        if (landed) break;
      }
    } else if ("wait" in step) {
      await page.waitForSelector(step.wait, { state: "visible", timeout: 10_000 });
    } else if ("fill" in step) {
      await page.getByPlaceholder(step.fill, { exact: false }).first().fill(step.text);
      // Let the debounce land, or the shot catches the pre-filter list.
      await page.waitForTimeout(500);
    } else if ("type" in step) {
      await page.keyboard.type(step.type);
      // Let the debounce land, or the shot catches the pre-filter list.
      await page.waitForTimeout(400);
    }
  }
}

/**
 * Wait until the page has stopped moving. The previous version swallowed every
 * timeout, which is how a 0-byte screenshot of a broken page ended up committed
 * and stayed there; failures here are thrown.
 */
async function settle(page: Page, shot: Shot, quiet: (quietMs?: number) => Promise<void>) {
  await quiet();

  if (shot.waitFor) {
    await page.waitForSelector(shot.waitFor, { state: "visible", timeout: 15_000 });
  }

  /**
   * Get every image on the page loaded.
   *
   * Two things make this more than one wait. Posters are `loading="lazy"`, so
   * anything below the fold never starts loading and captures as a blank tile —
   * this used to walk the whole page a viewport at a time and scroll back, but
   * asking the images directly says the same thing without laying out and
   * painting a hundred pages to do it. And some images don't exist yet: the
   * poster preview in Settings is rendered from a query's response, so "the
   * network is quiet and every image is complete" can both be true a frame
   * before the image is even in the document. So it repeats, and stops when a
   * whole pass finds nothing new.
   */
  let seen = -1;
  for (let pass = 0; pass < 4; pass++) {
    await quiet();
    const count = await page.evaluate(() => {
      for (const img of document.images) {
        if (img.loading === "lazy") img.loading = "eager";
      }
      return document.images.length;
    });
    await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, {
      timeout: 20_000,
    });
    if (count === seen) break;
    seen = count;
  }
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {}))));

  // Self-hosted fonts are `font-display: swap` and only two faces are
  // preloaded; a late face reflows the page after first paint.
  await page.evaluate(() => document.fonts.ready);

  if (!shot.allowSpinner) {
    await page
      .waitForFunction(() => !document.querySelector("[data-motion='essential']"), null, { timeout: 10_000 })
      .catch(() => {
        // A spinner that never resolves is worth seeing in the screenshot, but
        // not worth failing the run over — `allowSpinner` documents the ones we
        // know about.
        console.warn(`\n    (spinner still present in ${shot.name})`);
      });
  }

  await page.waitForTimeout(shot.settleMs ?? 250);
}

/**
 * Every shot loads its own page against the same read-only seed, so nothing
 * orders them — running one at a time left eleven of twelve cores idle for
 * three minutes. The cap is CPU-bound: rasterisation is on the CPU here (no
 * GPU in the container), so oversubscribing just makes each page slower.
 */
const CONCURRENCY = Number(process.env.TB_CAPTURE_CONCURRENCY) || Math.max(2, Math.min(12, cpus().length));

async function pool<T>(items: T[], limit: number, worker: (item: T, index: number, slot: number) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async (_, slot) => {
    for (let i = next++; i < items.length; i = next++) await worker(items[i]!, i, slot);
  });
  await Promise.all(runners);
}

async function capture(context: BrowserContext, shot: Shot, base: string): Promise<Buffer> {
  const page = await context.newPage();
  try {
    // Before any navigation, so module evaluation already sees the fixed time.
    await page.clock.setFixedTime(FIXED_NOW);

    for (const fragment of shot.failRoutes ?? []) {
      await page.route(`**/*${fragment}*`, (route) => route.abort());
    }

    // Stated from scratch, always. localStorage belongs to the context, not the
    // page, and contexts are reused across shots — a view toggle left behind by
    // an earlier shot would otherwise decide what this one renders.
    await page.addInitScript(
      (pairs: [string, string][]) => {
        localStorage.clear();
        for (const [k, v] of pairs) localStorage.setItem(k, v);
      },
      Object.entries(shot.storage ?? {}),
    );

    const quiet = watchNetwork(page);
    await page.goto(`${base}${shot.path}`, { waitUntil: "load", timeout: 45_000 });
    await quiet();
    if (shot.steps) await applySteps(page, shot.steps);
    await settle(page, shot, quiet);

    const raw = await page.screenshot({
      fullPage: false,
      // Playwright cancels infinite animations to their first frame. The app's
      // reduced-motion block deliberately exempts [data-motion="essential"], so
      // a spinner would otherwise capture at whatever angle it had reached.
      animations: "disabled",
      caret: "hide",
      scale: "css",
      type: "png",
    });

    // Re-encode through sharp. Chromium's PNG output is not byte-stable even
    // for identical pixels, which would show up as a diff on every run; this
    // makes the file depend on the image and nothing else.
    return await sharp(raw).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
  } finally {
    await page.close();
  }
}

// ─── Output ──────────────────────────────────────────────────────────────────

/**
 * Write only when the bytes differ. Determinism means an unrelated page
 * produces an identical PNG, and leaving that file untouched keeps a one-page
 * change to a one-file diff.
 */
async function writeIfChanged(path: string, bytes: Buffer): Promise<boolean> {
  if (bytes.length === 0) throw new Error(`Refusing to write an empty screenshot: ${path}`);
  try {
    const existing = await readFile(path);
    if (existing.equals(bytes)) return false;
  } catch {
    /* new file */
  }
  await writeFile(path, bytes);
  return true;
}

/** Drop PNGs that no longer correspond to a shot, so renames don't leave litter. */
async function pruneStale(dir: string, keep: Set<string>) {
  const present = await readdir(dir).catch(() => []);
  for (const file of present) {
    if (file.endsWith(".png") && !keep.has(file)) {
      await unlink(join(dir, file));
      console.log(`  – removed stale ${file}`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await assertPortFree(SERVER_PORT, "harness server");
  await assertPortFree(MOCK_PORT, "mock Plex");

  assertHarnessData(dataDir);
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  for (const dir of [join(suiteDir, "desktop"), join(suiteDir, "mobile"), siteDir]) {
    await mkdir(dir, { recursive: true });
  }

  // Chromium takes about as long to come up as the whole migrate-seed-boot
  // sequence, and it needs none of it. Start it first and it costs nothing.
  const browserReady = launch();

  const childEnv = { DATA_DIR: dataDir, TB_FIXED_NOW: String(FIXED_NOW), TZ: "UTC" };
  const preload = resolve(__dirname, "deterministic.mjs");

  step("starting mock Plex");
  const mock = await startMockPlex(MOCK_PORT);

  // The migrate-and-seed produces identical bytes every time, so the image
  // bakes the result into a layer and this copies it. The origin check is the
  // guard: the seeded config stores the Plex URL, so a template prepared
  // against a different mock would point the app somewhere that isn't serving.
  const template = process.env.TB_SEED_TEMPLATE;
  if (template && process.env.TB_SEED_ORIGIN === mock.origin && existsSync(template)) {
    step("copying prepared demo data");
    await cp(template, dataDir, { recursive: true });
  } else {
    step("migrating and seeding demo data");
    await run("node", ["--experimental-strip-types", resolve(__dirname, "prepare-data.ts"), dataDir, mock.origin], {
      cwd: appDir,
      env: childEnv,
    });
  }

  // A dev server would hand the browser several hundred unbundled modules on
  // every one of ~100 page loads, which dominated the run. The image bakes the
  // bundle into the layer that already invalidates on a source edit, so only a
  // native run pays for it here.
  const webBuilt =
    process.env.TB_WEB_PREBUILT === "1"
      ? Promise.resolve()
      : (step("building web bundle"),
        run("pnpm", ["exec", "vite", "build"], {
          cwd: resolve(repoRoot, "apps/web"),
          env: { VITE_TB_CAPTURE: "1" },
        }));

  step("starting server");
  startProcess("node", ["--import", preload, "src/server.ts"], {
    cwd: resolve(repoRoot, "apps/server"),
    env: {
      ...childEnv,
      HOST: "127.0.0.1",
      PORT: String(SERVER_PORT),
      // No cron, no catch-up: scheduled work would write new job runs while the
      // browser is walking the pages that display them.
      TB_DISABLE_SCHEDULER: "1",
    },
    tag: "server",
  });
  await webBuilt;

  await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/trpc/plexSections`);

  const browser = await browserReady;
  step("browser and server ready");
  // The admin server serves apps/web/dist itself, exactly as the production
  // image does, so the UI and the API share one origin and there is no second
  // web process to start or proxy through.
  const base = `http://127.0.0.1:${SERVER_PORT}`;

  /**
   * A context per (viewport, scale) *per worker*, rather than one shared by
   * all of them. localStorage is context-wide, so two shots running side by
   * side in one context overwrite each other's view toggles; a worker only
   * ever has one page open, so nothing races. They are made on demand and
   * reused, which keeps the bundle in each one's HTTP cache.
   */
  const contexts = new Map<string, BrowserContext>();
  async function contextFor(group: "desktop" | "mobile" | "site", slot: number): Promise<BrowserContext> {
    const key = `${group}#${slot}`;
    let context = contexts.get(key);
    if (!context) {
      context = await newContext(browser, group === "mobile" ? "mobile" : "desktop", group === "site" ? SITE_SCALE : 1);
      contexts.set(key, context);
    }
    return context;
  }

  interface Task {
    shot: Shot;
    group: "desktop" | "mobile" | "site";
    label: string;
    path: string;
  }

  const tasks: Task[] = [];
  for (const viewport of ["desktop", "mobile"] as Viewport[]) {
    for (const shot of SHOTS.filter((s) => (s.viewports ?? ["desktop", "mobile"]).includes(viewport))) {
      tasks.push({ shot, group: viewport, label: shot.name, path: join(suiteDir, viewport, `${shot.name}.png`) });
    }
  }
  // The marketing site's slugs, at retina, from the same run.
  for (const shot of SHOTS.filter((s) => s.site)) {
    tasks.push({ shot, group: "site", label: shot.site!, path: join(siteDir, `${shot.site}.png`) });
  }

  const results = Array.from<{ changed: boolean } | { error: string } | undefined>({ length: tasks.length });

  step(`capturing ${tasks.length} shots, ${CONCURRENCY} at a time`);
  console.log();
  const captureStart = Date.now();
  await pool(tasks, CONCURRENCY, async (task, i, slot) => {
    try {
      const bytes = await capture(await contextFor(task.group, slot), task.shot, base);
      results[i] = { changed: await writeIfChanged(task.path, bytes) };
    } catch (err) {
      // Carry on: one run should report everything that is broken, not just
      // the first thing. The run still fails at the end.
      results[i] = { error: (err as Error).message.split("\n")[0] };
    }
  });

  // Reported in task order rather than completion order, so the log reads the
  // same on every run however the pool happened to interleave.
  const manifestShots: Array<{ file: string; name: string; description: string; path: string }> = [];
  const failures: Array<{ shot: string; viewport: string; error: string }> = [];
  let written = 0;
  let unchanged = 0;
  let group = "";

  for (const [i, task] of tasks.entries()) {
    if (task.group !== group) {
      group = task.group;
      const count = tasks.filter((t) => t.group === group).length;
      console.log(group === "site" ? `marketing site (${count} shots @${SITE_SCALE}x)` : `${group} (${count} shots)`);
    }
    const result = results[i]!;
    if ("error" in result) {
      failures.push({ shot: task.label, viewport: task.group, error: result.error });
      console.log(`  • ${task.label} … FAILED`);
      continue;
    }
    if (result.changed) written++;
    else unchanged++;
    if (task.group !== "site") {
      manifestShots.push({
        file: `screenshots/${task.group}/${task.shot.name}.png`,
        name: task.shot.name,
        description: task.shot.description,
        path: task.shot.path,
      });
    }
    console.log(`  • ${task.label} … ${result.changed ? "updated" : "unchanged"}`);
  }
  console.log(`\n(captured in ${((Date.now() - captureStart) / 1000).toFixed(1)}s)`);

  // Only when the run was clean — otherwise a transient failure would delete a
  // screenshot that is still perfectly good.
  if (failures.length === 0) {
    for (const viewport of ["desktop", "mobile"] as Viewport[]) {
      const keep = tasks.filter((t) => t.group === viewport).map((t) => `${t.shot.name}.png`);
      await pruneStale(join(suiteDir, viewport), new Set(keep));
    }
  }

  await browser.close();
  await mock.close();

  const manifest = {
    $comment:
      "Generated by `pnpm screenshots`, which `pnpm release` runs for you. uiHash records the UI tree these images were rendered from. Do not edit by hand.",
    capturedAt: new Date(FIXED_NOW).toISOString(),
    uiHash: await computeUiHash(),
    playwright: (require("playwright/package.json") as { version: string }).version,
    chromium: browser.version(),
    viewports: VIEWPORTS,
    shots: manifestShots,
  };
  if (failures.length > 0) {
    // No manifest on a failed run: its uiHash claims these images match the
    // UI tree it names, and a partial set doesn't.
    console.error(`\n✗ ${failures.length} shot(s) failed:`);
    for (const f of failures) console.error(`    ${f.viewport}/${f.shot} — ${f.error}`);
    throw new Error(`${failures.length} shot(s) failed; manifest not written`);
  }

  await writeFile(join(suiteDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\n✓ ${written} updated, ${unchanged} unchanged → screenshots/`);
}

/**
 * The hash the pre-commit check compares against; see scripts/ui-hash.mjs.
 *
 * When the capture runs in the container it is handed the hash the host
 * computed, because the container only holds a copy of the source — it has no
 * index, and `git ls-files` there would describe a tree nobody is committing.
 */
async function computeUiHash(): Promise<string> {
  const provided = process.env.TB_UI_HASH;
  if (provided) return provided;
  const { uiHashFromWorktree } = await import(resolve(repoRoot, "scripts/ui-hash.mjs"));
  return uiHashFromWorktree(repoRoot);
}

main()
  .then(teardown)
  .catch(async (err) => {
    console.error("\n✗ capture failed:", err);
    await teardown();
    // Set the code and let the process end on its own: `process.exit()` here
    // dropped the message above, because writes to a pipe are asynchronous and
    // exiting doesn't wait for them. A failing run that says nothing is worse
    // than a slow one.
    process.exitCode = 1;
  });

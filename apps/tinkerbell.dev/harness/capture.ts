/**
 * Screenshot capture orchestrator.
 *
 * Runs the REAL admin UI against synthetic data and a mock Plex server, then
 * drives a headless browser over every shot in shots.ts.
 *
 * Pipeline:
 *   1. recreate an isolated DATA_DIR (never the repo-root tinkerbell.db)
 *   2. migrate that DB via the migrate script (per repo rule, never inline)
 *   3. start the in-process mock Plex (serves synthetic poster bytes)
 *   4. seed the DB (config → mock origin, sections, collections, media, …)
 *   5. start apps/server + apps/web vite, both with a frozen clock
 *   6. Playwright walks each shot at each viewport
 *   7. write only the files whose bytes actually changed, plus the manifest
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
import { rm, mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
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
const WEB_PORT = 39_302;
const MOCK_PORT = 39_303;

const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 430, height: 932 },
};

/** The marketing site's captures stay retina; the review suite is 1x. */
const SITE_SCALE = 2;

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

// ─── Per-shot driving ────────────────────────────────────────────────────────

async function applySteps(page: Page, steps: Step[]) {
  for (const step of steps) {
    if ("click" in step) {
      // Buttons first, then anything else carrying the name — several controls
      // are labelled inputs rather than buttons.
      const button = page.getByRole("button", { name: step.click, exact: false }).first();
      const labelled = page.getByLabel(step.click, { exact: false }).first();
      const target = (await button.count()) > 0 ? button : labelled;
      await target.click({ timeout: 10_000 });
    } else if ("clickSelector" in step) {
      await page.locator(step.clickSelector).first().click({ timeout: 10_000 });
    } else if ("clickText" in step) {
      await page.getByText(step.clickText, { exact: false }).first().click({ timeout: 10_000 });
    } else if ("press" in step) {
      await page.keyboard.press(step.press);
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
async function settle(page: Page, shot: Shot) {
  await page.waitForLoadState("networkidle");

  if (shot.waitFor) {
    await page.waitForSelector(shot.waitFor, { state: "visible", timeout: 15_000 });
  }

  // Posters are `loading="lazy"`, so anything below the fold never starts
  // loading and captures as a blank tile. Walk the page and come back.
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y < height; y += window.innerHeight) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(r));
  });

  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, {
    timeout: 20_000,
  });
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

async function capture(context: BrowserContext, shot: Shot, base: string): Promise<Buffer> {
  const page = await context.newPage();
  try {
    // Before any navigation, so module evaluation already sees the fixed time.
    await page.clock.setFixedTime(FIXED_NOW);

    for (const fragment of shot.failRoutes ?? []) {
      await page.route(`**/*${fragment}*`, (route) => route.abort());
    }

    if (shot.storage) {
      const entries = Object.entries(shot.storage);
      await page.addInitScript((pairs: [string, string][]) => {
        for (const [k, v] of pairs) localStorage.setItem(k, v);
      }, entries);
    }

    await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle", timeout: 45_000 });
    if (shot.steps) await applySteps(page, shot.steps);
    await settle(page, shot);

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
  await assertPortFree(WEB_PORT, "harness web");
  await assertPortFree(MOCK_PORT, "mock Plex");

  assertHarnessData(dataDir);
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  for (const dir of [join(suiteDir, "desktop"), join(suiteDir, "mobile"), siteDir]) {
    await mkdir(dir, { recursive: true });
  }

  const childEnv = { DATA_DIR: dataDir, TB_FIXED_NOW: String(FIXED_NOW), TZ: "UTC" };
  const preload = resolve(__dirname, "deterministic.mjs");

  console.log("→ migrating isolated DB");
  await run("pnpm", ["--filter", "@tinkerbell/db", "migrate"], { cwd: repoRoot, env: childEnv });

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
  startProcess("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: resolve(repoRoot, "apps/web"),
    env: {
      // Turns off react-query's polling and retries for this build only.
      VITE_TB_CAPTURE: "1",
      // Point the dev proxy at the harness server rather than :3000.
      TB_API_TARGET: `http://127.0.0.1:${SERVER_PORT}`,
    },
    tag: "web",
  });

  await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/api/trpc/plexSections`);
  await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`);

  console.log("→ launching browser\n");
  const browser = await launch();
  const base = `http://127.0.0.1:${WEB_PORT}`;

  const manifestShots: Array<{ file: string; name: string; description: string; path: string }> = [];
  const failures: Array<{ shot: string; viewport: string; error: string }> = [];
  let written = 0;
  let unchanged = 0;

  for (const viewport of ["desktop", "mobile"] as Viewport[]) {
    const context = await newContext(browser, viewport, 1);
    const dir = join(suiteDir, viewport);
    const shots = SHOTS.filter((s) => (s.viewports ?? ["desktop", "mobile"]).includes(viewport));
    console.log(`${viewport} (${shots.length} shots)`);

    for (const shot of shots) {
      process.stdout.write(`  • ${shot.name} … `);
      try {
        const bytes = await capture(context, shot, base);
        const changed = await writeIfChanged(join(dir, `${shot.name}.png`), bytes);
        if (changed) written++;
        else unchanged++;
        manifestShots.push({
          file: `screenshots/${viewport}/${shot.name}.png`,
          name: shot.name,
          description: shot.description,
          path: shot.path,
        });
        console.log(changed ? "updated" : "unchanged");
      } catch (err) {
        // Carry on: one run should report everything that is broken, not just
        // the first thing. The run still fails at the end.
        failures.push({ shot: shot.name, viewport, error: (err as Error).message.split("\n")[0] });
        console.log("FAILED");
      }
    }

    // Only when the run was clean — otherwise a transient failure would delete
    // a screenshot that is still perfectly good.
    if (failures.length === 0) await pruneStale(dir, new Set(shots.map((s) => `${s.name}.png`)));
    await context.close();
  }

  // The marketing site's eight slugs, at retina, from the same run.
  const siteShots = SHOTS.filter((s) => s.site);
  if (siteShots.length > 0) {
    console.log(`\nmarketing site (${siteShots.length} shots @${SITE_SCALE}x)`);
    const context = await newContext(browser, "desktop", SITE_SCALE);
    for (const shot of siteShots) {
      process.stdout.write(`  • ${shot.site} … `);
      try {
        const bytes = await capture(context, shot, base);
        const changed = await writeIfChanged(join(siteDir, `${shot.site}.png`), bytes);
        if (changed) written++;
        else unchanged++;
        console.log(changed ? "updated" : "unchanged");
      } catch (err) {
        failures.push({ shot: shot.site!, viewport: "site", error: (err as Error).message.split("\n")[0] });
        console.log("FAILED");
      }
    }
    await context.close();
  }

  await browser.close();
  await mock.close();

  const manifest = {
    $comment:
      "Generated by `pnpm screenshots`. uiHash guards staleness — see scripts/check-screenshots.mjs. Do not edit by hand.",
    capturedAt: new Date(FIXED_NOW).toISOString(),
    uiHash: await computeUiHash(),
    playwright: (require("playwright/package.json") as { version: string }).version,
    chromium: browser.version(),
    viewports: VIEWPORTS,
    shots: manifestShots,
  };
  if (failures.length > 0) {
    // No manifest on a failed run: its uiHash is the pre-commit hook's promise
    // that these images match the code, and a partial set doesn't.
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
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("\n✗ capture failed:", err);
    await teardown();
    process.exit(1);
  });

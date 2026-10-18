/**
 * A server for developing the native app against: the harness's seeded demo
 * library and mock Plex, plus a mock plex.tv, with admin sign-in on and the
 * portal open — so a simulator can do the whole connect → sign in → both
 * parts loop without a real Plex account approving every run.
 *
 * Differs from `serve.ts` in what the app needs and the browser doesn't:
 *
 * - **Both servers, on every interface.** The phone is another machine (the
 *   Android emulator reaches the host as 10.0.2.2), and the portal only runs
 *   while something needs it, so movie match and cleanup are switched on.
 * - **Sign-in is real.** Admin auth is enabled; the owner is whoever the mock
 *   plex.tv says the seeded server token belongs to, and the mock's sign-in
 *   page offers the owner and two shared users.
 * - **The connect link carries `plexTv=`**, which only a debug build of the
 *   app honours, pointing its PIN flow at the mock too.
 *
 * Usage: pnpm native:dev-server
 */
import { spawn, type ChildProcess } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startMockPlexTv } from "@tinkerbell/test-support/plex-tv";
import { nativeConnectLink } from "@tinkerbell/contracts";
import { startMockPlex } from "./mock-plex.ts";
import { FIXED_NOW } from "./clock.ts";
import { USERS } from "./data.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, "..");
const repoRoot = resolve(appDir, "../..");
const dataDir = resolve(appDir, ".native-dev-data");

const ADMIN_PORT = 39_311;
const PORTAL_PORT = 39_312;
const PLEX_TV_PORT = 39_313;
const MOCK_PLEX_PORT = 39_314;

/** The seeded server token's owner — a Plex account id the demo data doesn't use. */
export const OWNER = { id: 1, username: "owner" };

const children: ChildProcess[] = [];

function run(cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
  });
}

async function waitForHttp(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return undefined;
}

if (dataDir !== resolve(appDir, ".native-dev-data")) throw new Error(`Refusing to run: DATA_DIR is ${dataDir}`);
await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });

const childEnv = { DATA_DIR: dataDir, TB_FIXED_NOW: String(FIXED_NOW), TZ: "UTC" };
const preload = resolve(__dirname, "deterministic.mjs");

console.log("→ migrating isolated DB");
await run("pnpm", ["--filter", "@tinkerbell/db", "migrate"], { cwd: repoRoot, env: childEnv });

console.log("→ starting mock Plex and mock plex.tv");
const plex = await startMockPlex(MOCK_PLEX_PORT);
const plexTv = await startMockPlexTv({
  host: "0.0.0.0",
  port: PLEX_TV_PORT,
  defaultAccount: OWNER,
  tokens: { "demo-token": OWNER },
  accounts: [OWNER, ...USERS.slice(0, 2).map((u) => ({ id: u.userId, username: u.username }))],
});

console.log("→ seeding demo data");
const seedEnv = { ...childEnv, MOCK_PLEX_URL: plex.origin };
await run("node", ["--import", preload, "--experimental-strip-types", "harness/seed.ts"], {
  cwd: appDir,
  env: seedEnv,
});
const lan = lanAddress();
await run("node", ["--experimental-strip-types", "harness/native-seed.ts"], {
  cwd: appDir,
  env: { ...childEnv, NATIVE_PORTAL_URL: `http://${lan ?? "127.0.0.1"}:${PORTAL_PORT}` },
});

console.log("→ starting server");
const server = spawn("node", ["--import", preload, "src/server.ts"], {
  cwd: resolve(repoRoot, "apps/server"),
  env: {
    ...process.env,
    ...childEnv,
    HOST: "0.0.0.0",
    PORT: String(ADMIN_PORT),
    USER_PORT: String(PORTAL_PORT),
    TB_DISABLE_SCHEDULER: "1",
    TINKERBELL_PLEX_TV_URL: plexTv.origin,
  },
});
for (const stream of [server.stdout, server.stderr])
  stream?.on("data", (b: Buffer) => process.stdout.write(`[server] ${b}`));
children.push(server);

await waitForHttp(`http://127.0.0.1:${ADMIN_PORT}/api/trpc/auth.server`);
// The portal comes up on the server's reconcile tick once it sees match on.
await waitForHttp(`http://127.0.0.1:${PORTAL_PORT}/api/trpc/auth.server`, 30_000);

const link = (host: string) =>
  `${nativeConnectLink({ admin: `http://${host}:${ADMIN_PORT}`, portal: `http://${host}:${PORTAL_PORT}` })}&plexTv=${encodeURIComponent(`http://${host}:${PLEX_TV_PORT}`)}`;

console.log(`
✓ native dev server up

  admin   http://${lan ?? "127.0.0.1"}:${ADMIN_PORT}
  portal  http://${lan ?? "127.0.0.1"}:${PORTAL_PORT}
  plex.tv http://${lan ?? "127.0.0.1"}:${PLEX_TV_PORT} (mock — sign in as ${OWNER.username}, or a shared user)

  iOS simulator:     xcrun simctl openurl booted '${link("127.0.0.1")}'
  Android emulator:  adb shell am start -a android.intent.action.VIEW -d '${link("10.0.2.2")}'
${lan ? `  A phone on this network: open ${link(lan)}\n` : ""}`);

const shutdown = () => {
  for (const c of children) c.kill("SIGTERM");
  void plexTv.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

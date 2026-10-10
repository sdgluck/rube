// Build an app's bundled UI, sync it into the native project and open the IDE.
//
//   pnpm native:ios web             # the admin app in Xcode
//   pnpm native:android portal      # the portal app in Android Studio
//   pnpm native:ios web --live      # hot reload from the Vite dev server
//
// A thin wrapper so the two apps' names are the ones used everywhere else in
// the repo (`web`, `portal`) rather than their package names.
//
// --live points the app at the running Vite dev server (`pnpm dev`) instead of
// the bundled copy, so saving a file reloads the app in the simulator. In the
// app, connect to the dev server's own address (shown below): Vite proxies
// /api to the local Tinkerbell, so requests stay same-origin. Run a plain sync
// (without --live) before building anything to share — it writes the dev URL
// back out of the native config.

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const live = args.includes("--live");
const [platform, app = "web"] = args.filter((a) => !a.startsWith("--"));
if (!["ios", "android"].includes(platform) || !["web", "portal"].includes(app)) {
  console.error("usage: pnpm native:<ios|android> <web|portal> [--live]");
  process.exit(2);
}

const port = app === "web" ? 5173 : 5174;
// The Android emulator reaches the Mac at 10.0.2.2; the iOS simulator shares
// the Mac's own network, so localhost is the Mac there.
const devUrl = `http://${platform === "android" ? "10.0.2.2" : "localhost"}:${port}`;
const env = live ? { ...process.env, TB_NATIVE_DEV_URL: devUrl } : process.env;

const run = (...cmd) => {
  const { status } = spawnSync("pnpm", ["--filter", `@tinkerbell/${app}`, ...cmd], { stdio: "inherit", env });
  if (status !== 0) process.exit(status ?? 1);
};

if (live) {
  run("exec", "cap", "sync", platform);
  console.log(`\nLive reload: keep \`pnpm dev\` running, and in the app connect to ${devUrl}\n`);
} else {
  run("run", "native:sync");
}
run("exec", "cap", "open", platform);

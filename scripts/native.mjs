// Build an app's bundled UI, sync it into the native project and open the IDE.
//
//   pnpm native:ios web        # the admin app in Xcode
//   pnpm native:android portal # the portal app in Android Studio
//
// A thin wrapper so the two apps' names are the ones used everywhere else in
// the repo (`web`, `portal`) rather than their package names.

import { spawnSync } from "node:child_process";

const [platform, app = "web"] = process.argv.slice(2);
if (!["ios", "android"].includes(platform) || !["web", "portal"].includes(app)) {
  console.error("usage: pnpm native:<ios|android> <web|portal>");
  process.exit(2);
}

const run = (...args) => {
  const { status } = spawnSync("pnpm", ["--filter", `@tinkerbell/${app}`, ...args], { stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
};

run("run", "native:sync");
run("exec", "cap", "open", platform);

#!/usr/bin/env node
// Control the localias proxy that maps the dev servers' named hostnames onto
// their ports — see .localias.yaml at the repo root.
//
// The proxy is a convenience layer: the apps still serve on their raw ports,
// so a missing or failing localias never blocks `pnpm dev`.
//
//   node scripts/proxy.mjs up     start (or reload) the daemon
//   node scripts/proxy.mjs down   stop the daemon
import { spawnSync } from "node:child_process";

function localias(args, opts = {}) {
  return spawnSync("localias", args, { encoding: "utf8", ...opts });
}

const MISSING =
  "[proxy] localias not found — dev servers are only reachable on their raw ports.\n" +
  "[proxy] Install it with `mise install` (or `brew install peterldowns/tap/localias`).";

export function proxyUp() {
  const status = localias(["status"]);
  if (status.error) {
    console.warn(MISSING);
    return;
  }
  // `reload` applies .localias.yaml to an already-running daemon; `start` boots it.
  // Either may prompt for sudo the first time (hosts file + root certificate).
  const running = !/not running/i.test(status.stdout ?? "");
  const { status: code } = localias([running ? "reload" : "start"], { stdio: "inherit" });
  if (code !== 0) {
    console.warn("[proxy] localias failed to start — dev servers are still reachable on their raw ports.");
  }
}

export function proxyDown() {
  const { error } = localias(["stop"], { stdio: "inherit" });
  if (error) console.warn(MISSING);
}

if (import.meta.filename === process.argv[1]) {
  const command = process.argv[2];
  if (command === "up") proxyUp();
  else if (command === "down") proxyDown();
  else {
    console.error("usage: node scripts/proxy.mjs <up|down>");
    process.exit(1);
  }
}

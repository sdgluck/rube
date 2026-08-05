#!/usr/bin/env node
// Bring the localias proxy up, run the apps under Turbo, and tear the proxy
// back down when the dev session ends — including on Ctrl-C.
import { spawn } from "node:child_process";
import { proxyDown, proxyUp } from "./proxy.mjs";

proxyUp();

// Turbo owns the terminal and forwards signals to the app processes; we only
// need to wait for it to exit, whatever the reason, before stopping the proxy.
const turbo = spawn("pnpm", ["exec", "turbo", "run", "dev"], { stdio: "inherit" });

// Ctrl-C reaches turbo directly via the process group. Ignore it here so this
// wrapper outlives turbo and still gets to run the teardown below.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});

turbo.on("exit", (code, signal) => {
  proxyDown();
  if (signal) {
    // Re-raise so the shell sees the same signal turbo died from.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

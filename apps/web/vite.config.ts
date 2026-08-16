import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const rootPkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const changelog = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");

/**
 * The commit the bundle was built from. The Docker build has no .git, so an
 * image build passes it in the environment instead; when neither is available
 * the UI simply doesn't mention a commit.
 */
function gitSha(): string {
  const fromEnv = process.env.TB_GIT_SHA || process.env.SOURCE_COMMIT;
  if (fromEnv) return fromEnv.trim().slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __CHANGELOG__: JSON.stringify(changelog),
    __GIT_SHA__: JSON.stringify(gitSha()),
    // The screenshot harness serves a *built* bundle, but the suite documents
    // the dev-only pages (Settings → Stress Test and the nav entry that reaches
    // it) because it used to capture from the dev server. `vite build` pins
    // import.meta.env.DEV to false whatever the mode, which silently dropped
    // them, so capture builds say what they mean.
    ...(process.env.VITE_TB_CAPTURE === "1" ? { "import.meta.env.DEV": "true", "import.meta.env.PROD": "false" } : {}),
  },
  server: {
    // Fixed port so localias can map web.tinkerbell.localhost to it (.localias.yaml).
    port: 5173,
    strictPort: true,
    allowedHosts: [".tinkerbell.localhost"],
    proxy: {
      // The screenshot harness runs its own server on a high port so a capture
      // doesn't collide with a running dev stack.
      "/api": process.env.TB_API_TARGET || "http://localhost:3000",
    },
  },
});

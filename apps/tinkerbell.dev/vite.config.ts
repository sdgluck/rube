import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const rootPkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    // Fixed port so localias can map site.tinkerbell.localhost to it (.localias.yaml).
    port: 5175,
    strictPort: true,
    allowedHosts: [".tinkerbell.localhost"],
  },
});

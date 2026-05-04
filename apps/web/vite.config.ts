import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const rootPkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const changelog = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __CHANGELOG__: JSON.stringify(changelog),
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});

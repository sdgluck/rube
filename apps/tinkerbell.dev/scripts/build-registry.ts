/**
 * Emits the static registry that Tinkerbell instances fetch.
 *
 * Runs as `prebuild`, writing into `public/registry/` so `vite build` copies
 * the result to `dist/registry/` alongside the site. Everything goes through
 * `registryIndexSchema` first — a malformed pack fails the build here rather
 * than surfacing as a confusing import error on somebody's server.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistryIndex } from "../src/registry/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "registry");

async function main(): Promise<void> {
  const index = buildRegistryIndex(Date.now());

  // Wipe first so a pack deleted from source doesn't linger as a stale file
  // that the site still links to.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "packs"), { recursive: true });

  await writeFile(join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);

  const rulesBySlug = new Map(index.rules.map((r) => [r.slug, r]));
  for (const pack of index.packs) {
    // Self-contained per-pack files, so a link or a curl gets everything it
    // needs without also fetching the full index.
    const payload = {
      formatVersion: index.formatVersion,
      generatedAt: index.generatedAt,
      packs: [pack],
      rules: pack.ruleSlugs.flatMap((slug) => {
        const rule = rulesBySlug.get(slug);
        return rule ? [rule] : [];
      }),
    };
    await writeFile(join(outDir, "packs", `${pack.slug}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  }

  console.log(`[registry] wrote ${index.packs.length} pack(s) and ${index.rules.length} rule(s) to ${outDir}`);
}

await main();

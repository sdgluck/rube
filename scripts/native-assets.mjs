// Renders the native apps' icons and splash screens from `resources/icon.svg`.
//
//   node scripts/native-assets.mjs
//
// Overwrites, at its existing size, every placeholder PNG that `cap add`
// generated in `apps/{web,portal}/{ios,android}`. That is the whole set the
// platforms ask for, and keying on what is already there means a Capacitor
// template that adds or drops a density is followed without editing this.
//
// Not `@capacitor/assets`: it pins sharp 0.32, whose install script the
// workspace's build allow-list (pnpm-workspace.yaml) refuses under `pnpm dlx`,
// and adding it as a dependency would put a second, years-old sharp beside the
// one `packages/posters` already builds. This borrows that one.

import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sharp = createRequire(join(root, "packages/posters/package.json"))("sharp");

/** The splash is the dark page colour in both themes: it matches `SplashScreen.backgroundColor`. */
const SPLASH_PAGE = "#0a100f";

const APPS = {
  web: { background: "#127f76" },
  portal: { background: "#e5a00d" },
};

function* pngs(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* pngs(path);
    else if (name.endsWith(".png")) yield path;
  }
}

for (const [app, { background }] of Object.entries(APPS)) {
  const base = join(root, "apps", app);
  const svg = readFileSync(join(base, "resources/icon.svg"));
  // The mark alone, for Android's adaptive foreground and the splash: the icon
  // SVG with its background square removed.
  const markSvg = Buffer.from(svg.toString().replace(/<rect[^>]*\/>/, ""));

  const render = (source, size) => sharp(source, { density: 72 * Math.ceil(size / 32) }).resize(size, size);

  // The splash shows the whole icon as a rounded tile, as the favicon does —
  // the bare mark would vanish on the dark page in the portal's colours.
  const tileSvg = Buffer.from(svg.toString().replace("<rect ", '<rect rx="7" '));

  async function splash(width, height) {
    const side = Math.round(Math.min(width, height) * 0.3);
    const mark = await render(tileSvg, side).png().toBuffer();
    return sharp({ create: { width, height, channels: 3, background: SPLASH_PAGE } })
      .composite([{ input: mark, gravity: "center" }])
      .png()
      .toBuffer();
  }

  for (const platform of ["ios", "android"]) {
    for (const file of pngs(join(base, platform))) {
      const rel = relative(base, file);
      if (rel.includes("/build/") || rel.includes("/public/")) continue;
      const { width, height } = await sharp(file).metadata();
      let out;
      if (/splash/i.test(rel)) {
        out = await splash(width, height);
      } else if (rel.endsWith("ic_launcher_foreground.png")) {
        // Adaptive icons crop to the middle 66%; the mark sits inside that.
        const inner = Math.round(width * 0.6);
        const mark = await render(markSvg, inner).png().toBuffer();
        out = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: mark, gravity: "center" }])
          .png()
          .toBuffer();
      } else if (rel.endsWith("ic_launcher_round.png")) {
        const circle = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${width / 2}"/></svg>`,
        );
        out = await render(svg, width)
          .composite([{ input: circle, blend: "dest-in" }])
          .png()
          .toBuffer();
      } else {
        // App Store icons must have no alpha channel at all.
        out = await render(svg, width).flatten({ background }).png().toBuffer();
      }
      writeFileSync(file, out);
      console.log(`${app}/${rel} ${width}x${height}`);
    }
  }

  const colour = join(base, "android/app/src/main/res/values/ic_launcher_background.xml");
  writeFileSync(
    colour,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background.toUpperCase()}</color>\n</resources>\n`,
  );
}

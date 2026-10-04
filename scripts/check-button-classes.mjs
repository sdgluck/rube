#!/usr/bin/env node
/**
 * Fail the build on a button that has a colour but no size.
 *
 * `controls.btnPrimary` is only the colour half of a button — the height,
 * padding, radius and type are on `controls.btn`. Applied on its own from JSX
 * it renders as tinted text with no box: the *Arr pages shipped "New from
 * preset" as a 16px-tall green strip, and nineteen buttons like it across
 * Arr, Discover and the release table, because nothing could see them.
 * Stylelint's `tinkerbell/primitive-geometry` catches this in a `composes:`
 * line, but a className in a .tsx file is outside its reach — hence this.
 *
 * The rule: a className that uses a button variant (btnPrimary, btnSecondary,
 * btnGhost, btnDanger, btnDangerOutline) or modifier (btnSm, btnIcon) from
 * controls.module.css must also use `btn` from it; and shared.module.css's
 * `buttonSmall` modifier needs one of shared's buttons beside it. Better
 * still, compose a named class in the page's module and use that.
 *
 * Usage: node scripts/check-button-classes.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z", "apps/web/src/**/*.tsx"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const PARTS = /^(btnPrimary|btnSecondary|btnGhost|btnDanger|btnDangerOutline|btnSm|btnIcon)$/;
const SHARED_BUTTONS = /^(button|buttonSecondary|buttonGhost|buttonDanger)$/;

/** Every `className={…}` expression, braces balanced, with its line number. */
function* classNames(source) {
  const re = /className=\{/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
    }
    yield { expr: source.slice(re.lastIndex, i - 1), line: source.slice(0, m.index).split("\n").length };
  }
}

function importsOf(source, module) {
  return [...source.matchAll(new RegExp(`import\\s+(\\w+)\\s+from\\s+["'][^"']*/${module}["']`, "g"))].map((m) => m[1]);
}

const offenders = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const controls = importsOf(source, "controls\\.module\\.css");
  const shared = importsOf(source, "shared\\.module\\.css");
  if (controls.length === 0 && shared.length === 0) continue;

  for (const { expr, line } of classNames(source)) {
    const used = (names) =>
      names.flatMap((n) => [...expr.matchAll(new RegExp(`\\b${n}\\.(\\w+)`, "g"))].map((m) => m[1]));

    const fromControls = used(controls);
    const parts = fromControls.filter((c) => PARTS.test(c));
    if (parts.length > 0 && !fromControls.includes("btn")) {
      offenders.push(`${file}:${line}: ${parts.join(" ")} without btn — a button with no height or padding`);
    }

    const fromShared = used(shared);
    if (fromShared.includes("buttonSmall") && !fromShared.some((c) => SHARED_BUTTONS.test(c)) && !fromControls.includes("btn")) {
      offenders.push(`${file}:${line}: buttonSmall without a button — a size modifier on nothing`);
    }
  }
}

if (offenders.length > 0) {
  console.error("Button classes missing their base:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    "\nUse `controls.btn` alongside the variant, or better, a class in the page's module that " +
      '`composes: btn btnSecondary from "…/styles/controls.module.css"`.',
  );
  process.exit(1);
}

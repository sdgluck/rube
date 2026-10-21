/**
 * The size of a button, a field or a table row is decided once, in the
 * primitives — not per screen.
 *
 * `no-shadowed-primitive` stopped pages *redeclaring* `.table`. Drift came
 * back through the side door it left open: compose the primitive, then
 * override its geometry. Backup and Watchlist composed `.table` and set
 * `th { height: auto; padding: 6px 8px 6px 0 }`; the Overlays action bar built
 * three 30px buttons of its own; the Arr preset diff, the job config table and
 * Bandwidth/Health's run buttons never composed anything at all. Each was a
 * reasonable local call, and together they made new pages look squashed beside
 * old ones — 26px rows next to 38px rows, 30px buttons next to 32px inputs.
 *
 * Three checks, one rule:
 *
 *   1. A class that composes a button, field or table primitive may not set
 *      height, padding, font size, line height or radius. Colour, width and
 *      layout are still the page's. If the primitive's size is wrong
 *      everywhere, change the primitive; if one screen needs a different size,
 *      it is a modifier (`btnSm`, `btnIcon`, `compactTable`), added there.
 *   2. `th` / `td` geometry is the table primitive's alone, whichever class it
 *      hangs off — composing `.table` and then re-padding its cells is exactly
 *      the squashed table, and a table that composes nothing is the other half.
 *   3. A class *named* like a button (`saveBtn`, `refreshButton`,
 *      `actionBtnPrimary`) has to be built from one.
 *
 * A clickable thing that genuinely isn't a button — a card you can select, a
 * chip, a menu item, a timeline block — is fine, and is named for what it is.
 */

import stylelint from "stylelint";
import { collect, primitivesOf, subjectOf, STYLES_DIR } from "./composes.mjs";

const ruleName = "rube/primitive-geometry";

const messages = stylelint.utils.ruleMessages(ruleName, {
  override: (cls, kind, prop) =>
    `".${cls}" composes the ${kind} primitive, so its \`${prop}\` is the primitive's. ` +
    `Drop it, or use a size modifier from styles/ (btnSm, btnIcon, inputSm, compactTable) — add one there if none fits.`,
  cell: (el, prop) =>
    `\`${prop}\` on a ${el} is table geometry. Compose \`table\` or \`compactTable\` from styles/shared.module.css ` +
    `and let it size the cells.`,
  literalHeight: (cls, value) =>
    `".${cls}" is clickable and ${value} tall — a control height of its own. Use var(--control-h), or ` +
    `compose btn/btnIcon/input from styles/controls.module.css, so it lines up with the controls beside it.`,
  variantWithoutBase: (cls) =>
    `".${cls}" composes a button colour without \`btn\` itself, so it has the colours and none of the size — ` +
    `no height, no padding, no radius. Compose \`btn\` alongside it.`,
  bespokeButton: (cls) =>
    `".${cls}" is named as a button but isn't built from one. ` +
    `\`composes: btn btnSecondary from "…/styles/controls.module.css";\` (or btnPrimary, btnGhost, btnLink, btnDangerOutline) ` +
    `and keep only what is local, or rename it for what it is.`,
});

/**
 * The properties that make two of the same control look like different ones.
 * Per-corner radii are deliberately absent: squaring the joined edge of a split
 * button, or rounding a table's outer corners into its card, changes how the
 * thing meets its neighbour, not its size.
 */
const GEOMETRY = /^(height|min-height|max-height|padding(-(top|bottom|left|right|block|inline)(-(start|end))?)?|font-size|font|line-height|border-radius)$/;

/** A textarea is sized by what it holds — a prompt box is taller than a note. */
const CONTENT_SIZED = /^(min-height|max-height)$/;

/** A field's side inset makes room for an adornment (a clear button, a chevron)
    without touching its height or type. */
const INSET = /^padding-(left|right|inline(-start|-end)?)$/;

function allowed(kind, prop) {
  if (kind === "textarea" && CONTENT_SIZED.test(prop)) return true;
  if ((kind === "field" || kind === "textarea") && INSET.test(prop)) return true;
  return false;
}

/** primitive key → the kind of thing it is, for the message. */
const KIND = new Map([
  ["controls.module.css:btn", "button"],
  ["controls.module.css:input", "field"],
  ["controls.module.css:select", "field"],
  ["controls.module.css:textarea", "textarea"],
  ["controls.module.css:segmented", "segmented"],
  ["controls.module.css:segmentedItem", "segmented"],
  ["shared.module.css:table", "table"],
  ["shared.module.css:compactTable", "table"],
]);

/** What a class named like a button may be built from. `btnLink` has no box —
    its type is inherited from the sentence it sits in — so it is a button for
    the naming check without being one for the geometry check. */
const BUTTONS = new Set(["controls.module.css:btn", "controls.module.css:btnLink"]);

/** Built from a button — or from another control (`segmentedItem`, `pageTab`):
    a segment called `fooBtn` is misnamed, not bespoke. */
function isBuilt(file, cls, index) {
  for (const p of primitivesOf(file, cls, index)) if (BUTTONS.has(p) || p.startsWith("controls.module.css:")) return true;
  return false;
}

/** 24–48px: the band where a literal height is a control pretending not to be
    one. Smaller is an inline glyph (a chip's ×, a search field's clear), larger
    is a tile or a card. Read in design pixels: the app's stylesheets are rem
    at 1rem = 10px (see the root font-size in App.css), so 2.4–4.8rem is the
    same band. */
function controlSizedLiteral(value) {
  const m = value.trim().match(/^(\d*\.?\d+)(px|rem)$/);
  if (!m) return false;
  const px = m[2] === "rem" ? Number(m[1]) * 10 : Number(m[1]);
  return px >= 24 && px <= 48;
}

/** A colour variant is only half a button; the geometry is on `btn`. */
const VARIANTS = /^controls\.module\.css:btn(Primary|Secondary|Ghost|Danger|DangerOutline)$/;

function lacksBase(file, cls, index) {
  const ps = [...primitivesOf(file, cls, index)];
  return ps.some((p) => VARIANTS.test(p)) && !ps.includes("controls.module.css:btn");
}

function kindOf(file, cls, index) {
  for (const p of primitivesOf(file, cls, index)) if (KIND.has(p)) return KIND.get(p);
  return undefined;
}

/**
 * `saveBtn`, `refreshButton`, `actionBtnPrimary`, `btnRun` — but not a
 * container (`headerButtons`, `buttonRow`) or a part (`btnSpinner`, `btnLabel`).
 */
const BUTTON_NAME = /(?:^|[a-z])(?:btn|button)(?:Primary|Secondary|Ghost|Danger|Small|Sm|Active|Overflow|Outline|[A-Z][a-z]+Btn)?$/i;

const plugin = stylelint.createPlugin(ruleName, (enabled) => (root, result) => {
  if (!enabled) return;
  const file = root.source?.input?.file ?? "";
  if (!file.endsWith(".module.css") || file.includes(`/${STYLES_DIR}/`)) return;

  const index = collect(file, root);

  root.walkRules((rule) => {
    /* Keyframe steps are rules too. */
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    const decls = rule.nodes.filter((n) => n.type === "decl");

    for (const selector of rule.selectors) {
      const { classes, element } = subjectOf(selector);

      if (element === "th" || element === "td") {
        for (const d of decls) {
          if (GEOMETRY.test(d.prop)) stylelint.utils.report({ result, ruleName, node: d, message: messages.cell(element, d.prop) });
        }
        continue;
      }

      for (const cls of classes) {
        if (selector.trim() === `.${cls}` && lacksBase(file, cls, index)) {
          stylelint.utils.report({ result, ruleName, node: rule, message: messages.variantWithoutBase(cls) });
        }
        const kind = kindOf(file, cls, index);
        if (!kind && selector.trim() === `.${cls}` && decls.some((d) => d.prop === "cursor" && d.value === "pointer")) {
          const h = decls.find((d) => (d.prop === "height" || d.prop === "min-height") && controlSizedLiteral(d.value));
          if (h) stylelint.utils.report({ result, ruleName, node: h, message: messages.literalHeight(cls, h.value) });
        }
        if (kind) {
          for (const d of decls) {
            if (GEOMETRY.test(d.prop) && !allowed(kind, d.prop))
              stylelint.utils.report({ result, ruleName, node: d, message: messages.override(cls, kind, d.prop) });
          }
        } else if (selector.trim() === `.${cls}` && BUTTON_NAME.test(cls) && !isBuilt(file, cls, index)) {
          stylelint.utils.report({ result, ruleName, node: rule, message: messages.bespokeButton(cls) });
        }
      }
    }
  });
});

plugin.ruleName = ruleName;
plugin.messages = messages;

export default plugin;

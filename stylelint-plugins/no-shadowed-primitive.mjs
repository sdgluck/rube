/**
 * The one rule no off-the-shelf plugin can know about: a page or component
 * module must not *declare* a class named after a shared primitive. It has to
 * `composes:` the real one, or call its own thing something else.
 *
 * This is the drift that costs the most. `.table` was declared in four
 * stylesheets — a 32px header here, a 44px row there, one with borders of its
 * own — and every copy was individually reasonable. Nobody sees the divergence,
 * because nobody opens four files at once. A token rule catches a wrong colour;
 * this catches a whole second implementation.
 *
 * Both ways out are fine, and which one is right depends on the answer to "is
 * this the same thing?":
 *
 *   .table { composes: table from "../../styles/shared.module.css"; }  // yes
 *   .packCard { ... }                                                 // no — rename
 *
 * The names are listed rather than derived, because plenty of what lives in
 * styles/ is genuinely generic — a page may have its own `.header`, `.field` or
 * `.hint` without it meaning anything. But every listed name is checked against
 * the primitive stylesheets at lint time, so the list can't rot: delete a
 * primitive and this fails loudly instead of silently guarding nothing.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import stylelint from "stylelint";

const ruleName = "tinkerbell/no-shadowed-primitive";

const messages = stylelint.utils.ruleMessages(ruleName, {
  shadowed: (name, source) =>
    `".${name}" is a shared primitive from ${source}. Either \`composes: ${name} from "…/${source}";\` ` +
    `and add only what is local to this screen, or give this class a name of its own.`,
  missing: (name, source) => `"${name}" is listed as a primitive but ${source} no longer defines it.`,
});

const STYLES = "apps/web/src/styles";

/** name → the stylesheet that owns it. Validated below. */
const PRIMITIVES = {
  "shared.module.css": [
    "table",
    "compactTable",
    "tableFooter",
    "clickableRow",
    "selectedRow",
    "checkbox",
    "checkboxCell",
    "filters",
    "emptyState",
    "bulkBar",
    "card",
    "cardPoster",
    "statusPill",
    "pageTabs",
    "viewToggle",
    /* These four live in shared.module.css rather than controls.module.css —
       they are the composed spellings (`.button` composes `btn btnPrimary`),
       which is what a page is meant to reach for. */
    "button",
    "buttonSecondary",
    "buttonDanger",
  ],
  "controls.module.css": ["btn", "input", "inputSm", "select", "textarea", "segmented", "segmentedItem"],
};

/** The list above is checked once per run, not once per stylesheet. */
let validated = false;

const plugin = stylelint.createPlugin(ruleName, (enabled) => (root, result) => {
  if (!enabled) return;

  const owner = new Map();
  for (const [file, names] of Object.entries(PRIMITIVES)) {
    const source = readFileSync(join(process.cwd(), STYLES, file), "utf8");
    for (const name of names) {
      if (!new RegExp(`^\\.${name}[\\s,{:]`, "m").test(source)) {
        if (!validated) stylelint.utils.report({ result, ruleName, node: root, message: messages.missing(name, file) });
        continue;
      }
      owner.set(name, file);
    }
  }
  validated = true;

  const file = root.source?.input?.file ?? "";
  if (file.includes(`/${STYLES.split("/").pop()}/`) || !file.endsWith(".module.css")) return;

  root.walkRules((rule) => {
    /* Only a bare, top-level class selector declares a primitive. A compound or
       descendant selector (`.table td`, `td.previewBlockCell`) is reaching into
       one, which is a different thing and often necessary. */
    for (const selector of rule.selectors) {
      const name = selector.match(/^\.([A-Za-z][\w-]*)$/)?.[1];
      if (!name || !owner.has(name)) continue;
      if (rule.some((node) => node.type === "decl" && node.prop === "composes")) continue;

      stylelint.utils.report({ result, ruleName, node: rule, message: messages.shadowed(name, owner.get(name)) });
    }
  });
});

plugin.ruleName = ruleName;
plugin.messages = messages;

export default plugin;

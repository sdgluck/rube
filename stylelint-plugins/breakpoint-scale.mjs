/**
 * One responsive scale, not eleven.
 *
 * The app had media queries at 480, 560, 600, 620, 640, 700, 720, 768, 800,
 * 900 and 1100px. Every one of them was chosen honestly — it is the width at
 * which *that* panel started to look cramped — and together they meant nobody
 * could say what the app's layout does at 610px without opening fifty
 * stylesheets. Two pages reflowing 20px apart is not a design; it is the
 * absence of one.
 *
 * So: five steps, and a lint error for anything else. Picking the nearest step
 * *up* is almost always the right remap — a panel that stacks slightly earlier
 * than it strictly had to is fine, whereas one that stacks later overflows.
 *
 * The scale is also declared as --bp-* tokens in App.css, which is where it is
 * documented and where JS reads it. It cannot be *used* from there: custom
 * properties don't resolve inside a media feature, and no amount of wanting
 * changes that. The tokens are the statement of the scale; this rule is what
 * makes the statement true.
 */

import stylelint from "stylelint";

const ruleName = "tinkerbell/breakpoint-scale";

/** Keep in step with the --bp-* tokens in apps/web/src/App.css. */
export const BREAKPOINTS = [480, 640, 768, 900, 1100];

/** `min-width` queries are written against the step above, exclusive. */
const MIN_WIDTHS = BREAKPOINTS.map((b) => b + 1);

const messages = stylelint.utils.ruleMessages(ruleName, {
  offScale: (feature, value, nearest) =>
    `${feature}: ${value}px is not on the responsive scale. Use ${nearest}px ` +
    `(the scale is ${BREAKPOINTS.join(", ")}px — see --bp-* in App.css). ` +
    `If this screen genuinely needs a step the app doesn't have, add it to the scale rather than to this file.`,
});

/** The nearest allowed value at or above `value`, else the largest step. */
function nearestUp(value, allowed) {
  return allowed.find((b) => b >= value) ?? allowed[allowed.length - 1];
}

const plugin = stylelint.createPlugin(ruleName, (enabled) => (root, result) => {
  if (!enabled) return;

  root.walkAtRules(/^media$/i, (atRule) => {
    for (const match of atRule.params.matchAll(/\b(max-width|min-width)\s*:\s*(\d+)px/gi)) {
      const [, feature, raw] = match;
      const value = Number(raw);
      const allowed = feature.toLowerCase() === "min-width" ? MIN_WIDTHS : BREAKPOINTS;
      if (allowed.includes(value)) continue;

      stylelint.utils.report({
        result,
        ruleName,
        node: atRule,
        word: `${value}px`,
        message: messages.offScale(feature, value, nearestUp(value, allowed)),
      });
    }
  });
});

plugin.ruleName = ruleName;
plugin.messages = messages;

export default plugin;

/**
 * Lengths are rem, so the interface has one size knob.
 *
 * The admin UI's root font size is `62.5% * --ui-scale` (App.css), and every
 * length in its stylesheets is a rem of it — which is what lets Settings →
 * Appearance make the whole app smaller or larger. A px length opts out of
 * that: it stays put while everything around it scales, and at 85% a 32px
 * button sits in a 27px toolbar.
 *
 * Before this rule there were ~3,000 px literals and no way to offer the
 * setting at all, so the rule is what keeps it possible.
 *
 * Allowed:
 *   - 2px or less. Hairlines, focus-ring offsets and 1px nudges are about the
 *     device's pixels, not the design's — a 1px border scaled to 0.85px is a
 *     blur, not a smaller border.
 *   - At-rule params. Breakpoints describe the viewport, which the setting
 *     doesn't change (see rube/breakpoint-scale).
 *   - `--bp-*`, the breakpoint scale's own declaration.
 *
 * Write the rem at 1rem = 10px: 13px is `1.3rem`.
 */

import stylelint from "stylelint";

const ruleName = "rube/no-px";

const messages = stylelint.utils.ruleMessages(ruleName, {
  px: (value) =>
    `${value}px doesn't scale with the interface size. Use ${+(value / 10).toFixed(4)}rem ` +
    `(1rem = 10px — see the root font-size in App.css).`,
});

const PX = /(^|[^\w.#-])-?(\d*\.?\d+)px\b/g;

const plugin = stylelint.createPlugin(ruleName, (enabled) => (root, result) => {
  if (!enabled) return;

  root.walkDecls((decl) => {
    if (decl.prop.startsWith("--bp-")) return;
    for (const match of decl.value.matchAll(PX)) {
      const value = Number(match[2]);
      if (value <= 2) continue;
      stylelint.utils.report({
        result,
        ruleName,
        node: decl,
        word: `${match[2]}px`,
        message: messages.px(value),
      });
    }
  });
});

plugin.ruleName = ruleName;
plugin.messages = messages;

export default plugin;

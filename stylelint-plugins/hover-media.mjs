/**
 * Hover styles only where something can hover.
 *
 * A touchscreen synthesises `:hover` on tap and then never clears it, so on a
 * phone a tapped button kept its hover colour until the next tap somewhere
 * else, and a row stayed highlighted after you came back to the list. That is
 * the single most "this is a web page" tell in a native wrapper, and there
 * were 164 such rules when the apps shipped.
 *
 * So every `:hover` selector lives inside `@media (hover: hover)`. Anything a
 * hover *reveals* (a remove button, a caption) needs its own
 * `@media (hover: none)` rule that shows it outright, because touch has no
 * other way to reach it.
 */

import stylelint from "stylelint";

const ruleName = "tinkerbell/hover-media";

const messages = stylelint.utils.ruleMessages(ruleName, {
  bare: (selector) =>
    `"${selector}" styles :hover outside @media (hover: hover), so it sticks after a tap on a touchscreen. ` +
    `Wrap it in @media (hover: hover) — and if the hover reveals something, show it under @media (hover: none).`,
});

function insideHoverMedia(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && /^media$/i.test(p.name) && /\(\s*hover\s*:\s*hover\s*\)/i.test(p.params)) return true;
  }
  return false;
}

const plugin = stylelint.createPlugin(ruleName, (enabled) => (root, result) => {
  if (!enabled) return;
  root.walkRules((rule) => {
    if (!rule.selector.includes(":hover") || insideHoverMedia(rule)) return;
    stylelint.utils.report({ result, ruleName, node: rule, message: messages.bare(rule.selector) });
  });
});

plugin.ruleName = ruleName;
plugin.messages = messages;
export default plugin;

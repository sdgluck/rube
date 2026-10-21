import { test } from "node:test";
import assert from "node:assert/strict";
import stylelint from "stylelint";
import hoverMedia from "./hover-media.mjs";

async function lint(code: string): Promise<number> {
  const { results } = await stylelint.lint({
    code,
    config: { plugins: [hoverMedia], rules: { "rube/hover-media": true } },
  });
  return results[0]!.warnings.length;
}

test("a bare :hover rule is reported", async () => {
  assert.equal(await lint(`.row:hover { background: var(--fill-quiet); }`), 1);
});

test("a :hover rule inside @media (hover: hover) passes, even nested in another query", async () => {
  assert.equal(await lint(`@media (hover: hover) { .row:hover { color: var(--ink); } }`), 0);
  assert.equal(
    await lint(`@media (max-width: 768px) { @media (hover: hover) { .row:hover { color: var(--ink); } } }`),
    0,
  );
});

test("other queries don't count as guarding it", async () => {
  assert.equal(await lint(`@media (pointer: fine) { .row:hover { color: var(--ink); } }`), 1);
});

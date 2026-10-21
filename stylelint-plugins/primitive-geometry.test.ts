import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import stylelint from "stylelint";
import primitiveGeometry from "./primitive-geometry.mjs";

/* A real path under apps/web/src so `composes … from "../styles/…"` resolves
   to the actual primitive stylesheets — the rule is only as good as that
   lookup, so stubbing it would test nothing. */
const FILE = join(import.meta.dirname, "../apps/web/src/components/Fixture.module.css");

async function lint(code: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    code,
    codeFilename: FILE,
    config: { plugins: [primitiveGeometry], rules: { "rube/primitive-geometry": true } },
  });
  return results[0]!.warnings.map((w) => w.text);
}

test("re-padding a composed table's cells is reported", async () => {
  const warnings = await lint(`
    .list { composes: table from "../styles/shared.module.css"; }
    .list th { height: auto; padding: 6px 8px; }
  `);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /table geometry/);
});

test("a hand-rolled table's cell padding is reported too", async () => {
  const warnings = await lint(`.diff td { padding: 4px 12px; }`);
  assert.equal(warnings.length, 1);
});

test("a composed button may change colour and width, not size", async () => {
  assert.deepEqual(
    await lint(
      `.save { composes: btn btnPrimary from "../styles/controls.module.css"; width: 100%; color: var(--ink); }`,
    ),
    [],
  );
  const warnings = await lint(`.save { composes: btn btnPrimary from "../styles/controls.module.css"; height: 30px; }`);
  assert.match(warnings[0]!, /composes the button primitive/);
});

test("composition is followed through local classes", async () => {
  const warnings = await lint(`
    .base { composes: btn btnSecondary from "../styles/controls.module.css"; }
    .square { composes: base; padding: 0; }
  `);
  assert.equal(warnings.length, 1);
});

test("a class named as a button must be built from one", async () => {
  const warnings = await lint(`.refreshBtn { padding: 8px 16px; cursor: pointer; }`);
  assert.match(warnings[0]!, /named as a button/);
  assert.deepEqual(await lint(`.refreshBtn { composes: btn btnSecondary from "../styles/controls.module.css"; }`), []);
  assert.deepEqual(await lint(`.editLinkBtn { composes: btnLink from "../styles/controls.module.css"; }`), []);
});

test("a colour variant without btn is reported", async () => {
  const warnings = await lint(`.rowButton { composes: btnGhost btnSm from "../styles/controls.module.css"; }`);
  assert.match(warnings[0]!, /without `btn`/);
});

test("a clickable thing at a literal control height is reported", async () => {
  const warnings = await lint(`.close { width: 28px; height: 28px; cursor: pointer; }`);
  assert.match(warnings[0]!, /control height of its own/);
  assert.deepEqual(await lint(`.chipRemove { height: 16px; cursor: pointer; }`), []);
});

test("the control-height band is read in rem too", async () => {
  const warnings = await lint(`.close { width: 2.8rem; height: 2.8rem; cursor: pointer; }`);
  assert.match(warnings[0]!, /control height of its own/);
  assert.deepEqual(await lint(`.chipRemove { height: 1.6rem; cursor: pointer; }`), []);
});

test("a textarea may be taller; a field may inset for an adornment", async () => {
  assert.deepEqual(
    await lint(`
      .prompt { composes: textarea from "../styles/controls.module.css"; min-height: 180px; }
      .search { composes: input from "../styles/controls.module.css"; padding-right: 28px; }
    `),
    [],
  );
});

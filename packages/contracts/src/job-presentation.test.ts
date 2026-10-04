import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_PRESENTATION, SYSTEM_GROUPS } from "./job-presentation.ts";

test("every system task says which System Tasks section it belongs in", () => {
  const ungrouped = Object.entries(JOB_PRESENTATION)
    .filter(([, p]) => p.kind === "system" && !p.group)
    .map(([id]) => id);
  assert.deepEqual(ungrouped, [], "a new system job needs a `group` — otherwise it lands in Maintenance by default");
});

test("only system tasks carry a group, and every group has something in it", () => {
  for (const [id, p] of Object.entries(JOB_PRESENTATION)) {
    if (p.kind !== "system") assert.equal(p.group, undefined, `${id} is a ${p.kind}, not a system task`);
  }
  const used = new Set(Object.values(JOB_PRESENTATION).map((p) => p.group));
  for (const g of SYSTEM_GROUPS) assert.ok(used.has(g.id), `${g.id} has no tasks`);
});

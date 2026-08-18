import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { CleanupToken } from "@tinkerbell/domain.cleanup";

test("a domain test can build the real container", async () => {
  const c = createTestContainer();
  try {
    const cleanup = c.resolve(CleanupToken);
    assert.equal(typeof cleanup.listCandidates, "function");
  } finally {
    await c.dispose();
  }
});

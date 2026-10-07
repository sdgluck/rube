import { test } from "node:test";
import assert from "node:assert/strict";
import { filenameFrom } from "./download.ts";

test("filenameFrom reads the name the server chose", () => {
  assert.equal(filenameFrom('attachment; filename="tinkerbell-2026.json"'), "tinkerbell-2026.json");
  assert.equal(filenameFrom("attachment; filename*=UTF-8''a%20b.db.gz"), "a b.db.gz");
  assert.equal(filenameFrom(null), null);
});

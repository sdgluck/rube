/**
 * Every field the settings form renders must be a key the server accepts, and
 * every default it shows must be a value the server accepts — otherwise a form
 * can offer something that fails on Save, or show a number the job doesn't use.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commandsWithFields, fieldsFor } from "./job-fields.ts";
import { configSchemaFor } from "./job-config.ts";

describe("job field descriptors", () => {
  for (const command of commandsWithFields()) {
    it(`${command}: every field is a key its schema accepts, with a valid default`, () => {
      const schema = configSchemaFor(command);
      for (const field of fieldsFor(command)) {
        assert.ok(field.key in schema.shape, `${command}.${field.key} is not in its schema`);
        if (field.default !== undefined) {
          assert.ok(
            schema.partial().safeParse({ [field.key]: field.default }).success,
            `${command}.${field.key} default ${JSON.stringify(field.default)} fails validation`,
          );
        }
        if (field.showWhen) {
          assert.ok(
            fieldsFor(command).some((f) => f.key === field.showWhen!.key),
            `${field.key} depends on a missing field`,
          );
        }
      }
    });
  }

  it("offers a library picker exactly where the command reads one", () => {
    assert.equal(fieldsFor("sync-media")[0]?.key, "sections");
    assert.equal(fieldsFor("posters-refresh").length, 0);
  });
});

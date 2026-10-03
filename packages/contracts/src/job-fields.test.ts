/**
 * Every field the settings form renders must be a key the server accepts, and
 * every default it shows must be a value the server accepts — otherwise a form
 * can offer something that fails on Save, or show a number the job doesn't use.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allVariants, commandsWithFields, fieldsFor, variantsForJob } from "./job-fields.ts";
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
    assert.ok(!fieldsFor("digest").some((f) => f.key === "sections"));
  });
});

describe("run variants", () => {
  it("override only keys their command accepts, with values it accepts", () => {
    for (const [command, variant] of allVariants()) {
      const parsed = configSchemaFor(command).partial().strict().safeParse(variant.overrides);
      assert.ok(parsed.success, `${command}/${variant.id}: ${JSON.stringify(variant.overrides)}`);
    }
  });

  it("aren't offered when they'd change nothing", () => {
    const ids = (jobId: string, command: string, stored: Record<string, unknown>) =>
      variantsForJob(jobId, command, stored).map((v) => v.id);
    assert.deepEqual(ids("collections-sweep", "collections-sweep", {}), ["preview"]);
    assert.deepEqual(ids("collections-sweep", "collections-sweep", { dryRun: true }), ["delete"]);
    assert.deepEqual(ids("overlays", "overlays", {}), ["remove"]);
    assert.deepEqual(ids("overlays-remove", "overlays", {}), []);
  });
});

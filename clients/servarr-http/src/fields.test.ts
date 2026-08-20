import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactProviderSecrets, mergeFieldValues, secretFieldNames, isSecretField } from "./fields.ts";
import type { ServarrProvider } from "./fields.ts";

const indexer: ServarrProvider = {
  id: 1,
  name: "NZBgeek",
  implementation: "Newznab",
  fields: [
    { name: "baseUrl", value: "https://api.nzbgeek.info", privacy: "normal" },
    { name: "apiKey", value: "real-secret-value", privacy: "apiKey" },
    { name: "password", value: "hunter2", privacy: "password" },
    { name: "minimumSeeders", value: 1 },
  ],
};

describe("isSecretField", () => {
  it("treats an absent privacy as normal", () => {
    assert.equal(isSecretField({ name: "minimumSeeders" }), false);
  });

  // userName is in Servarr's privacy enum but is not a credential we need to
  // withhold, and blanking it would make a drift comparison useless.
  it("does not treat userName as secret", () => {
    assert.equal(isSecretField({ name: "username", privacy: "userName" }), false);
  });
});

describe("redactProviderSecrets", () => {
  it("blanks secret values and leaves everything else intact", () => {
    const out = redactProviderSecrets(indexer);

    assert.equal(out.fields[0].value, "https://api.nzbgeek.info");
    assert.equal(out.fields[1].value, "");
    assert.equal(out.fields[2].value, "");
    assert.equal(out.fields[3].value, 1);
  });

  it("keeps the field itself, so a snapshot still shows the shape", () => {
    const out = redactProviderSecrets(indexer);
    assert.equal(out.fields.length, indexer.fields.length);
    assert.equal(out.fields[1].name, "apiKey");
  });

  it("does not mutate its input", () => {
    redactProviderSecrets(indexer);
    assert.equal(indexer.fields[1].value, "real-secret-value");
  });
});

describe("mergeFieldValues", () => {
  it("applies edited values by name", () => {
    const out = mergeFieldValues(indexer.fields, { minimumSeeders: 5 });
    assert.equal(out[3].value, 5);
  });

  /**
   * The clobbering guard. A Servarr PUT replaces the provider wholesale, so a
   * field the renderer did not know about — one added by a newer release —
   * must survive the round trip. Walking the schema rather than the edits is
   * what makes that true.
   */
  it("keeps schema fields the caller said nothing about", () => {
    const out = mergeFieldValues(indexer.fields, { minimumSeeders: 5 });

    assert.equal(out.length, 4);
    assert.equal(out[0].value, "https://api.nzbgeek.info");
    assert.equal(out[1].value, "real-secret-value");
  });

  it("ignores values with no matching schema field", () => {
    const out = mergeFieldValues(indexer.fields, { fieldFromTheFuture: true });
    assert.equal(out.length, 4);
    assert.ok(!out.some((f) => f.name === "fieldFromTheFuture"));
  });

  it("applies an explicit empty string, so a field can be cleared", () => {
    const out = mergeFieldValues(indexer.fields, { baseUrl: "" });
    assert.equal(out[0].value, "");
  });
});

describe("secretFieldNames", () => {
  it("names the fields a redacted form must not post back blank", () => {
    assert.deepEqual(secretFieldNames(indexer), ["apiKey", "password"]);
  });
});

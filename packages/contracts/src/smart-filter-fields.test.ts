import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalField, LOCAL_FIELD_PREFIX } from "@rube/plex-smart-filter";
import { isNonPortableField, isTagField, ruleConfigSchema, TAG_FIELDS } from "./rule-config.ts";
import { fieldDef, fieldLabel, LOCAL_FIELD_DEFS, SMART_FILTER_FIELD_DEFS } from "./smart-filter-fields.ts";

/**
 * `source: "local"` and the `tb.` prefix are two spellings of the same fact,
 * and they are read by different code — the UI groups on `source`, while the
 * splitter and every log line key off the prefix. A field that carries one
 * without the other is invisible to half the feature.
 */
test("every local field is prefixed, and every prefixed field is local", () => {
  for (const def of SMART_FILTER_FIELD_DEFS) {
    assert.equal(
      def.source === "local",
      isLocalField(def.field),
      `"${def.field}" disagrees with itself: source=${def.source ?? "plex"}, prefixed=${isLocalField(def.field)}`,
    );
  }
});

test("local fields are hidden from nothing and declared once", () => {
  assert.ok(LOCAL_FIELD_DEFS.length > 0);
  const seen = new Set<string>();
  for (const def of LOCAL_FIELD_DEFS) {
    assert.ok(def.field.startsWith(LOCAL_FIELD_PREFIX));
    assert.ok(!seen.has(def.field), `"${def.field}" declared twice`);
    seen.add(def.field);
    // A field with no hint reaches the picker as a bare label, and the whole
    // point of the group is that the distinction from Plex's own view state
    // needs explaining.
    assert.ok(def.hint, `"${def.field}" needs a hint`);
  }
});

test("every field has a curated label — none falls through to the camelCase fallback", () => {
  for (const def of SMART_FILTER_FIELD_DEFS) {
    assert.equal(fieldLabel(def.field), def.label);
    // The fallback would render `tb.watchedByAll` as "Tb.watchedByAll".
    assert.ok(!fieldLabel(def.field).startsWith("Tb."), `"${def.field}" is falling through to humanize()`);
  }
});

test("tag-key translation does not apply to local fields", () => {
  // `tb.watchedBy` is kind "tag" so the UI knows its value is picked from a
  // list, but its value is a Plex account id — not a per-section tag key.
  assert.equal(fieldDef("tb.watchedBy")?.kind, "tag");
  assert.equal(isTagField("tb.watchedBy"), false);
  assert.ok(!TAG_FIELDS.includes("tb.watchedBy"));
  assert.equal(isTagField("genre"), true);
});

test("tb.watchedBy is marked non-portable", () => {
  assert.equal(isNonPortableField("tb.watchedBy"), true);
  assert.equal(isNonPortableField("tb.watchedByAll"), false);
  assert.equal(isNonPortableField("genre"), false);
});

// ─── ruleConfigSchema guards ─────────────────────────────────────────────────

const leaf = (field: string, value = "1") => ({ kind: "leaf" as const, field, op: "=" as const, value });

test("a local leaf AND'd with Plex clauses parses", () => {
  const parsed = ruleConfigSchema.safeParse({
    smartFilter: { kind: "group", combinator: "all", children: [leaf("genre", "Horror"), leaf("tb.watchedByAll")] },
  });
  assert.ok(parsed.success, parsed.error?.message);
});

test("a local leaf inside an OR group is rejected", () => {
  const parsed = ruleConfigSchema.safeParse({
    smartFilter: { kind: "group", combinator: "any", children: [leaf("genre", "Horror"), leaf("tb.watchedByAll")] },
  });
  assert.equal(parsed.success, false);
  assert.match(parsed.error!.issues[0].message, /AND/);
  assert.deepEqual(parsed.error!.issues[0].path, ["smartFilter"]);
});

test("a local leaf inside a nested OR group is rejected too", () => {
  const parsed = ruleConfigSchema.safeParse({
    smartFilter: {
      kind: "group",
      combinator: "all",
      children: [
        leaf("year", "2000"),
        { kind: "group", combinator: "any", children: [leaf("genre", "Horror"), leaf("tb.watchedByNobody")] },
      ],
    },
  });
  assert.equal(parsed.success, false);
});

test("an OR group with no local leaves still parses", () => {
  const parsed = ruleConfigSchema.safeParse({
    smartFilter: { kind: "group", combinator: "any", children: [leaf("genre", "Horror"), leaf("genre", "Thriller")] },
  });
  assert.ok(parsed.success, parsed.error?.message);
});

test("a config with no smart filter is untouched by the guard", () => {
  assert.ok(ruleConfigSchema.safeParse({ prompt: "anything" }).success);
});

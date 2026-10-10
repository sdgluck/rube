import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isPortalComponentId,
  PORTAL_COMPONENTS,
  resolvePortalComponents,
  TASTES_PREFERENCE_KEYS,
} from "./portal-components.ts";

const ALL_MET = { cleanup: true, smtp: true, match: true };

describe("resolvePortalComponents", () => {
  test("everything is on by default once its features are", () => {
    const states = resolvePortalComponents([], ALL_MET);
    assert.ok(Object.values(states).every((s) => s.on));
  });

  test("a switched-on component still needs its feature", () => {
    const states = resolvePortalComponents([], { cleanup: false, smtp: true, match: true });
    assert.deepEqual(states["tab.leaving"], { enabled: true, on: false, unmet: "cleanup" });
  });

  test("a tab takes its sections and actions with it", () => {
    const states = resolvePortalComponents(["tab.tastes", "tab.leaving"], ALL_MET);
    assert.equal(states["tastes.moods"].on, false);
    assert.equal(states["tastes.moods"].enabled, true, "the child's own switch is untouched");
    assert.equal(states["action.keep"].on, false);
    assert.equal(states["action.notForMe"].on, true);
  });

  test("a parent's unmet feature reaches its children", () => {
    const states = resolvePortalComponents([], { cleanup: false, smtp: true, match: true });
    assert.equal(states["action.keep"].on, false);
  });

  test("an id stored by a build that has since retired it is ignored", () => {
    const states = resolvePortalComponents(["tab.retired"], ALL_MET);
    assert.ok(Object.values(states).every((s) => s.on));
  });
});

describe("the component list", () => {
  test("lists every parent before its children", () => {
    // `resolvePortalComponents` reads a parent's state while resolving the child.
    const seen = new Set<string>();
    for (const c of PORTAL_COMPONENTS) {
      if ("parent" in c) assert.ok(seen.has(c.parent), `${c.id} is listed before ${c.parent}`);
      seen.add(c.id);
    }
  });

  test("every tastes section owns at least one preference key", () => {
    for (const c of PORTAL_COMPONENTS.filter((c) => c.group === "tastes")) {
      assert.ok(TASTES_PREFERENCE_KEYS[c.id]?.length, `${c.id} has no keys, so hiding it hides nothing on save`);
    }
  });

  test("movie match stays off until it is turned on", () => {
    const states = resolvePortalComponents([], { cleanup: true, smtp: true, match: false });
    assert.deepEqual(states["tab.match"], { enabled: true, on: false, unmet: "match" });
  });

  test("isPortalComponentId", () => {
    assert.equal(isPortalComponentId("tab.leaving"), true);
    assert.equal(isPortalComponentId("tab.nope"), false);
  });
});

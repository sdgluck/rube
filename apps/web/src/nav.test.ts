import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NAV_SECTIONS,
  applyNavPrefs,
  defaultItemOrder,
  defaultSectionOrder,
  mergeOrder,
  resolveNav,
  type NavSection,
} from "./nav.ts";

/** A small stand-in, so a test doesn't fail the day a page is added to the real menu. */
function fixture(): NavSection[] {
  return [
    {
      id: "one",
      label: "One",
      items: [
        { to: "/a", label: "A" },
        { to: "/b", label: "B" },
      ],
    },
    {
      id: "two",
      label: "Two",
      items: [
        { to: "/c", label: "C" },
        { to: "/d", label: "D" },
        { to: "/settings", label: "Settings" },
        { to: "/setup", label: "Setup", hideWhenSetupComplete: true },
      ],
    },
  ];
}

const paths = (sections: NavSection[]) => sections.flatMap((s) => s.items.map((i) => i.to));

describe("mergeOrder", () => {
  const defaults = ["a", "b", "c", "d"];

  test("an unset or empty saved order is the defaults", () => {
    assert.deepEqual(mergeOrder(defaults, undefined), defaults);
    assert.deepEqual(mergeOrder(defaults, []), defaults);
  });

  test("a saved permutation is respected", () => {
    assert.deepEqual(mergeOrder(defaults, ["d", "a", "c", "b"]), ["d", "a", "c", "b"]);
  });

  test("ids we no longer ship are dropped, and duplicates deduped", () => {
    assert.deepEqual(mergeOrder(defaults, ["d", "gone", "a", "d", "b", "c"]), ["d", "a", "b", "c"]);
  });

  test("an id the saved order has never seen lands beside its default neighbour, not at the end", () => {
    // "c" is new. It shipped after "b", so it goes back after "b" — appending
    // it would put a new Library page underneath Settings.
    assert.deepEqual(mergeOrder(defaults, ["d", "b", "a"]), ["d", "b", "c", "a"]);
  });

  test("a new id that is first in the defaults lands first", () => {
    assert.deepEqual(mergeOrder(defaults, ["c", "b", "d"]), ["a", "c", "b", "d"]);
  });

  test("the result is always a permutation of the defaults", () => {
    for (const saved of [undefined, [], ["d"], ["x", "y"], ["b", "b", "b"], ["d", "c", "b", "a"]]) {
      const out = mergeOrder(defaults, saved);
      assert.equal(out.length, defaults.length);
      assert.deepEqual([...out].sort(), [...defaults].sort());
    }
  });
});

describe("applyNavPrefs", () => {
  test("sections reorder by id", () => {
    const out = applyNavPrefs(fixture(), { sectionOrder: ["two", "one"] });
    assert.deepEqual(
      out.map((s) => s.id),
      ["two", "one"],
    );
  });

  test("items reorder within their section", () => {
    const out = applyNavPrefs(fixture(), { itemOrder: ["/b", "/a", "/d", "/c", "/settings", "/setup"] });
    assert.deepEqual(paths(out), ["/b", "/a", "/d", "/c", "/settings", "/setup"]);
  });

  test("an order implying a cross-section move is inert", () => {
    // "/d" ranked before "/a" would put it in section one if the sort were
    // global. It isn't — an item's section is fixed by the catalogue.
    const out = applyNavPrefs(fixture(), { itemOrder: ["/d", "/a", "/b", "/c", "/settings", "/setup"] });
    assert.deepEqual(
      out.map((s) => s.items.map((i) => i.to)),
      [
        ["/a", "/b"],
        ["/d", "/c", "/settings", "/setup"],
      ],
    );
  });

  test("hidden items go, and a section emptied by hiding goes with them", () => {
    const out = applyNavPrefs(fixture(), { hidden: ["/a", "/b"] });
    assert.deepEqual(
      out.map((s) => s.id),
      ["two"],
    );
  });

  test("/settings cannot be hidden, however it got into the list", () => {
    const out = applyNavPrefs(fixture(), { hidden: ["/settings", "/c"] });
    assert.ok(paths(out).includes("/settings"));
    assert.ok(!paths(out).includes("/c"));
  });

  test("unknown ids in every key are inert", () => {
    const out = applyNavPrefs(fixture(), {
      hidden: ["/nope"],
      itemOrder: ["/nope"],
      sectionOrder: ["nope"],
    });
    assert.deepEqual(paths(out), paths(fixture()));
  });
});

describe("resolveNav", () => {
  test("keeps a setup-only item while the status query is still in flight", () => {
    assert.ok(paths(resolveNav(fixture(), {}, undefined)).includes("/setup"));
  });

  test("drops it once setup is complete", () => {
    assert.ok(!paths(resolveNav(fixture(), {}, true)).includes("/setup"));
  });

  test("hiding and hideWhenSetupComplete compose without leaving an empty section", () => {
    const out = resolveNav(fixture(), { hidden: ["/c", "/d", "/settings"] }, true);
    // "/settings" survives the hidden list, so section two stays — but "/setup"
    // is gone, which is the pair that used to be able to strand an empty one.
    assert.deepEqual(
      out.map((s) => s.items.map((i) => i.to)),
      [["/a", "/b"], ["/settings"]],
    );
  });
});

describe("the catalogue", () => {
  test("every section and item id is unique", () => {
    const ids = defaultSectionOrder(NAV_SECTIONS);
    assert.equal(new Set(ids).size, ids.length);
    const tos = defaultItemOrder(NAV_SECTIONS);
    assert.equal(new Set(tos).size, tos.length);
  });

  test("is not narrowed by prefs — hiding a page must not remove it from the catalogue", () => {
    // routeTrail, useDocumentTitle, RouteAnnouncer and the command palette all
    // read NAV_SECTIONS directly. A resolver that mutated it would make a
    // hidden page unreachable and unbreadcrumbed, not merely unlisted.
    const before = defaultItemOrder(NAV_SECTIONS);
    resolveNav(NAV_SECTIONS, { hidden: before, sectionOrder: ["admin"] }, true);
    assert.deepEqual(defaultItemOrder(NAV_SECTIONS), before);
  });
});

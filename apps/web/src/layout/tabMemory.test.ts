import { test } from "node:test";
import assert from "node:assert/strict";
import { MORE, tabFor, tabTapAction } from "./tabMemory.ts";

const ROOTS = ["/stats", "/collections", "/jobs"];

test("a path belongs to the deepest tab that contains it, else More", () => {
  assert.equal(tabFor("/collections/42", ROOTS), "/collections");
  assert.equal(tabFor("/jobs", ROOTS), "/jobs");
  assert.equal(tabFor("/settings/plex", ROOTS), MORE);
  assert.equal(tabFor("/collectionsx", ROOTS), MORE);
});

test("tapping another tab returns to where it was left", () => {
  assert.deepEqual(
    tabTapAction({
      tapped: "/collections",
      currentTab: "/jobs",
      pathname: "/jobs/run/1",
      remembered: "/collections/42?tab=items",
    }),
    { kind: "navigate", to: "/collections/42?tab=items" },
  );
  assert.deepEqual(tabTapAction({ tapped: "/stats", currentTab: "/jobs", pathname: "/jobs", remembered: undefined }), {
    kind: "navigate",
    to: "/stats",
  });
});

test("tapping the current tab pops to its root, then scrolls to the top", () => {
  assert.deepEqual(
    tabTapAction({ tapped: "/jobs", currentTab: "/jobs", pathname: "/jobs/run/1", remembered: "/jobs/run/1" }),
    { kind: "navigate", to: "/jobs" },
  );
  assert.deepEqual(tabTapAction({ tapped: "/jobs", currentTab: "/jobs", pathname: "/jobs", remembered: "/jobs" }), {
    kind: "scrollTop",
  });
});

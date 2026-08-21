import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_SECTIONS, defaultItemOrder } from "../nav.ts";
import { NAV_ICONS, NAV_ICON_FALLBACK, navIcon } from "./navIcons.ts";

test("every nav route has an icon of its own", () => {
  // Any route can be put in the tab bar now, and a tab is an icon with a label
  // under it. A page added without a line in NAV_ICONS still renders — it just
  // renders as a dot beside four real icons, which is what this catches.
  const missing = defaultItemOrder(NAV_SECTIONS).filter((to) => !NAV_ICONS[to]);
  assert.deepEqual(missing, []);
});

test("the bar's own More tab has one too", () => {
  assert.ok(NAV_ICONS["/more"]);
});

test("an unknown route falls back rather than rendering nothing", () => {
  assert.equal(navIcon("/not-a-page"), NAV_ICON_FALLBACK);
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Just enough of a browser's history for the overlay stack: entries, pushState, back → popstate. */
function fakeBrowser(phone = true) {
  const entries: unknown[] = [{ idx: 0 }];
  let index = 0;
  const listeners: ((e: { state: unknown }) => void)[] = [];
  const history = {
    get state() {
      return entries[index];
    },
    pushState(state: unknown) {
      entries.splice(index + 1);
      entries.push(state);
      index++;
    },
    back() {
      if (index === 0) return;
      index--;
      // Real browsers fire popstate asynchronously; synchronous is fine for the logic.
      for (const l of listeners) l({ state: entries[index] });
    },
  };
  const window = {
    matchMedia: () => ({ matches: phone }),
    addEventListener: (_: string, l: (e: { state: unknown }) => void) => listeners.push(l),
  };
  Object.assign(globalThis, { window, history });
  return { history, entries: () => entries.slice(0, index + 1) };
}

let mod: typeof import("./overlay-history.ts");
let n = 0;
beforeEach(async () => {
  // A fresh module per test: the stack is module state.
  mod = await import(`./overlay-history.ts?case=${n++}`);
});

test("Back closes the open sheet instead of leaving the page", () => {
  const b = fakeBrowser();
  let closed = 0;
  mod.pushOverlay(() => closed++);
  assert.equal(b.entries().length, 2);
  b.history.back();
  assert.equal(closed, 1);
  assert.equal(b.entries().length, 1);
});

test("closing it with ✕ removes its history entry, without calling close again", () => {
  const b = fakeBrowser();
  let closed = 0;
  const release = mod.pushOverlay(() => closed++);
  release();
  assert.equal(closed, 0);
  assert.equal(b.entries().length, 1);
  // A later Back is an ordinary one, not swallowed by a stale entry.
  release();
  assert.equal(b.entries().length, 1);
});

test("with two stacked, Back closes only the top one", () => {
  const b = fakeBrowser();
  const closed: string[] = [];
  mod.pushOverlay(() => closed.push("sheet"));
  mod.pushOverlay(() => closed.push("menu"));
  b.history.back();
  assert.deepEqual(closed, ["menu"]);
  b.history.back();
  assert.deepEqual(closed, ["menu", "sheet"]);
});

test("the router's own state survives the extra entry", () => {
  const b = fakeBrowser();
  mod.pushOverlay(() => {});
  assert.equal((b.history.state as { idx: number }).idx, 0);
});

test("on a desktop nothing is pushed", () => {
  const b = fakeBrowser(false);
  const release = mod.pushOverlay(() => assert.fail("should not close"));
  assert.equal(b.entries().length, 1);
  release();
});

/**
 * The translation is lossy, and the two ways to get it wrong both produce a
 * rule that looks fine: ANDing several values of one filter matches nothing,
 * and silently dropping a filter Plex can't express matches far too much.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { describeDropped, ruleSeedFromView, type MediaViewFilters } from "./viewToRule.ts";

const EMPTY: MediaViewFilters = {
  sections: [],
  types: [],
  search: "",
  resolutions: [],
  videoCodecs: [],
  audioCodecs: [],
  audioChannels: [],
  containers: [],
  labels: [],
};

const titles: Record<string, string> = { "1": "Movies", "2": "TV Shows" };
const titleFor = (key: string) => titles[key] ?? null;

test("ruleSeedFromView", async (t) => {
  await t.test("an unfiltered view produces an empty filter", () => {
    const seed = ruleSeedFromView(EMPTY, titleFor);
    assert.deepEqual(seed.smartFilter.children, []);
    assert.deepEqual(seed.sections, []);
    assert.deepEqual(seed.dropped, []);
  });

  await t.test("sections cross over as titles, which is what a rule stores", () => {
    const seed = ruleSeedFromView({ ...EMPTY, sections: ["1", "2"] }, titleFor);
    assert.deepEqual(seed.sections, ["Movies", "TV Shows"]);
  });

  await t.test("a section the server no longer has is left out rather than guessed at", () => {
    const seed = ruleSeedFromView({ ...EMPTY, sections: ["1", "99"] }, titleFor);
    assert.deepEqual(seed.sections, ["Movies"]);
  });

  await t.test("search becomes a title clause", () => {
    const seed = ruleSeedFromView({ ...EMPTY, search: "  blade runner " }, titleFor);
    assert.deepEqual(seed.smartFilter.children, [{ kind: "leaf", field: "title", op: "=", value: "blade runner" }]);
  });

  await t.test("one resolution is one clause", () => {
    const seed = ruleSeedFromView({ ...EMPTY, resolutions: ["4k"] }, titleFor);
    assert.deepEqual(seed.smartFilter.children, [{ kind: "leaf", field: "resolution", op: "=", value: "4k" }]);
  });

  await t.test("several resolutions are an OR, not an impossible AND", () => {
    // ANDing them would produce a rule matching nothing at all, which is the
    // failure most likely to be mistaken for an empty library.
    const seed = ruleSeedFromView({ ...EMPTY, resolutions: ["4k", "1080"] }, titleFor);
    const group = seed.smartFilter.children[0] as { kind: string; combinator: string; children: unknown[] };
    assert.equal(group.kind, "group");
    assert.equal(group.combinator, "any");
    assert.equal(group.children.length, 2);
  });

  await t.test("labels cross over, ORed like any other multi-value filter", () => {
    // Unlike codec or container, Plex smart filters can express a label — so it
    // is carried rather than reported as dropped.
    const one = ruleSeedFromView({ ...EMPTY, labels: ["Keep"] }, titleFor);
    assert.deepEqual(one.smartFilter.children, [{ kind: "leaf", field: "label", op: "=", value: "Keep" }]);
    assert.deepEqual(one.dropped, []);

    const two = ruleSeedFromView({ ...EMPTY, labels: ["Keep", "Kids"] }, titleFor);
    const group = two.smartFilter.children[0] as { combinator: string; children: unknown[] };
    assert.equal(group.combinator, "any");
    assert.equal(group.children.length, 2);
  });

  await t.test("filters Plex can't express are reported, not dropped in silence", () => {
    const seed = ruleSeedFromView({ ...EMPTY, audioCodecs: ["truehd"], containers: ["mkv"] }, titleFor);
    assert.deepEqual(seed.dropped, ["audio codec", "container"]);
    assert.deepEqual(seed.smartFilter.children, []);
  });

  await t.test("media type is not carried — the section choice already says it", () => {
    const seed = ruleSeedFromView({ ...EMPTY, types: ["movie"] }, titleFor);
    assert.deepEqual(seed.smartFilter.children, []);
    assert.deepEqual(seed.dropped, []);
  });
});

test("describeDropped", async (t) => {
  await t.test("says nothing when nothing was lost", () => {
    assert.equal(describeDropped([]), null);
  });

  await t.test("reads as a sentence for one, and for several", () => {
    assert.match(describeDropped(["container"])!, /can't express container.*that filter was/);
    assert.match(describeDropped(["audio codec", "container"])!, /audio codec and container.*those filters were/);
  });
});

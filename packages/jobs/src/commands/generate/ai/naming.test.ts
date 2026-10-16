import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNamingPrompt, namingList, parseNames, TITLES_PER_COLLECTION } from "./naming.ts";

test("names come back by position, cleaned", () => {
  const text = `[{"index":2,"name":"Old Hollywood: Glamour"},{"index":1,"name":"  Slow  Dread "}]`;
  assert.deepEqual(parseNames(text, 2), ["Slow Dread", "Old Hollywood Glamour"]);
});

test("a name the model fumbles keeps the old one", () => {
  const text = JSON.stringify([
    { index: 1, name: "Fine" },
    { index: 2, name: "fine" }, // a repeat, ignoring case
    { index: 3, name: "" },
    { index: 4, name: "x".repeat(61) },
    { index: 9, name: "Out of range" },
    { index: 1, name: "Second answer for one" },
  ]);
  assert.deepEqual(parseNames(text, 4), ["Fine", undefined, undefined, undefined]);
});

test("an answer that isn't JSON changes nothing", () => {
  assert.deepEqual(parseNames("Sure! Here are some names…", 2), [undefined, undefined]);
  assert.deepEqual(parseNames(`{"index":1}`, 1), [undefined]);
});

test("tolerates prose around the array", () => {
  assert.deepEqual(parseNames(`Here you go:\n[{"index":1,"name":"Night Shift"}]\nEnjoy`, 1), ["Night Shift"]);
});

test("each collection is one line, capped at a readable sample", () => {
  const titles = Array.from({ length: 30 }, (_, i) => `Film ${i}`);
  const list = namingList([
    { name: "A", titles },
    { name: "B\nC", titles: ["Line\nbreak (1999)"] },
  ]);
  const lines = list.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.split("; ").length, TITLES_PER_COLLECTION);
  assert.equal(lines[1], `2. "B C": Line break (1999)`);
});

test("the prompt carries the rule's style and the names to avoid", () => {
  const prompt = buildNamingPrompt({
    sectionTitle: "Films",
    count: 3,
    vibe: "serious",
    nameStyle: "short_punchy",
    history: [{ name: "Echoes of Time" } as never],
  });
  assert.match(prompt, /3 numbered lines/);
  assert.match(prompt, /"Echoes of Time"/);
});

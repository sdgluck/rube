import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { comboView } from "./combobox.ts";

const MODELS = [
  { value: "qwen3-tinkerbell:latest" },
  { value: "qwen3:8b" },
  { value: "llama3.1:8b", label: "Llama 3.1 8B" },
  { value: "gemma3:12b" },
];

describe("comboView", () => {
  test("opened without typing, everything shows — even with a chosen value in the field", () => {
    // The datalist bug: a saved value filtered the list down to itself.
    assert.equal(comboView(MODELS, "", false).options.length, 4);
    assert.equal(comboView(MODELS, "qwen3-tinkerbell:latest", true).options.length, 4);
  });

  test("typing filters on the value or the label, and counts what it hid", () => {
    assert.deepEqual(comboView(MODELS, "QWEN", false), { options: MODELS.slice(0, 2), hidden: 2 });
    assert.deepEqual(
      comboView(MODELS, "llama 3", false).options.map((o) => o.value),
      ["llama3.1:8b"],
    );
  });

  test("no match leaves every option behind the show-all row, not gone", () => {
    assert.deepEqual(comboView(MODELS, "mistral", false), { options: [], hidden: 4 });
  });
});

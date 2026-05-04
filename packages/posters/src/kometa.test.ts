import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveKometaUrl } from "./kometa.ts";

test("flat kind resolves to Default-Images/<kind>/<name>.jpg", () => {
  assert.equal(
    resolveKometaUrl({ provider: "kometa", kind: "studio", name: "A24" }),
    "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/studio/A24.jpg",
  );
});

test("flat kind URL-encodes special characters", () => {
  assert.equal(
    resolveKometaUrl({ provider: "kometa", kind: "genre", name: "Sci-Fi & Fantasy" }),
    "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/genre/Sci-Fi%20%26%20Fantasy.jpg",
  );
});

test("styled kind defaults to color", () => {
  assert.equal(
    resolveKometaUrl({ provider: "kometa", kind: "network", name: "AMC" }),
    "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/network/color/AMC.jpg",
  );
});

test("styled kind honors explicit style", () => {
  assert.equal(
    resolveKometaUrl({ provider: "kometa", kind: "country", name: "France", style: "white" }),
    "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/country/white/France.jpg",
  );
});

test("person kind defaults to bw style and uses first letter folder", () => {
  assert.equal(
    resolveKometaUrl({ provider: "kometa", kind: "actor", name: "Tom Hanks" }),
    "https://raw.githubusercontent.com/Kometa-Team/People-Images-bw/master/T/Images/Tom%20Hanks.jpg",
  );
});

test("person kind appends offset suffix when > 0", () => {
  assert.equal(
    resolveKometaUrl({
      provider: "kometa",
      kind: "actor",
      name: "Richard Brooks",
      offset: 2,
    }),
    "https://raw.githubusercontent.com/Kometa-Team/People-Images-bw/master/R/Images/Richard%20Brooks%20(2).jpg",
  );
});

test("person kind respects style", () => {
  assert.equal(
    resolveKometaUrl({
      provider: "kometa",
      kind: "director",
      name: "Greta Gerwig",
      style: "diiivoycolor",
    }),
    "https://raw.githubusercontent.com/Kometa-Team/People-Images-diiivoycolor/master/G/Images/Greta%20Gerwig.jpg",
  );
});

test("person kind with non-letter first character falls back to 0", () => {
  assert.equal(
    resolveKometaUrl({ provider: "kometa", kind: "actor", name: "50 Cent" }),
    "https://raw.githubusercontent.com/Kometa-Team/People-Images-bw/master/0/Images/50%20Cent.jpg",
  );
});

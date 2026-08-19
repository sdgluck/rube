import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { traktListPath } from "./trakt.ts";

/**
 * List references arrive from two places that write them differently: a person
 * pasting a share URL into the wizard, and a Kometa config that has been using
 * whichever form its author preferred for years. Both have to work, and a
 * reference that can't be read has to say so rather than produce a URL that
 * 404s later inside a nightly run.
 */
describe("reading a Trakt list reference", () => {
  test("accepts a share URL, which is what people actually paste", () => {
    assert.equal(
      traktListPath("https://trakt.tv/users/someone/lists/my-favourites"),
      "/users/someone/lists/my-favourites",
    );
  });

  test("tolerates the trailing slash a browser adds", () => {
    assert.equal(
      traktListPath("https://trakt.tv/users/someone/lists/my-favourites/"),
      "/users/someone/lists/my-favourites",
    );
  });

  test("accepts the short user/slug form", () => {
    assert.equal(traktListPath("someone/my-favourites"), "/users/someone/lists/my-favourites");
  });

  test("accepts a bare numeric list id", () => {
    assert.equal(traktListPath("12345"), "/lists/12345");
  });

  test("encodes each segment so a slug can't escape into the query string", () => {
    const path = traktListPath("someone/list?limit=1");
    assert.equal(path, "/users/someone/lists/list%3Flimit%3D1");
    // The separators must survive the encoding, or the path addresses nothing.
    assert.equal(path.split("/").length, 5);
  });

  test("drops a query string from a pasted URL rather than encoding it into the slug", () => {
    assert.equal(
      traktListPath("https://trakt.tv/users/someone/lists/favourites?sort=rank"),
      "/users/someone/lists/favourites",
    );
  });

  test("refuses something that isn't a list reference, with a usable message", () => {
    assert.throws(() => traktListPath("not a list"), /Use the list's URL/);
    assert.throws(() => traktListPath(""), /Use the list's URL/);
  });
});

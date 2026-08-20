/**
 * "What does this shared user actually see on their Plex home screen?"
 *
 * The answer is reconstructed from the admin's own view plus the user's share
 * record, and the reconstruction has three parts worth pinning:
 *
 * - **`parseLabelFilter`.** Plex's share filter is a small expression language
 *   — `,` is AND, `|` is OR, and each clause may carry a redundant `label=`
 *   prefix. Misreading it shows the admin a preview that does not match what
 *   the user sees, which is worse than showing nothing, because they will act
 *   on it.
 * - **The two fallbacks.** When the user is not in the sharings list, or has no
 *   `SharedServer` record, the preview deliberately shows **unfiltered** hubs
 *   and appends a warning. That is the branch most likely to mislead, so the
 *   warning is the feature and is asserted here.
 * - **`isPersonalProgressHub`.** Continue Watching and On Deck reflect the
 *   *admin's* progress and cannot be reproduced for someone else, so they are
 *   dropped rather than shown as though they were the user's. Plex spells the
 *   identifier several ways across versions, which is why the check is a pile
 *   of `includes` and why it needs a table of cases.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  getPreviewForUser,
  isPersonalProgressHub,
  itemPassesLabelFilter,
  parseLabelFilter,
} from "@tinkerbell/domain.preview";
import type { PlexClient } from "@tinkerbell/plex";

const item = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    ratingKey: "1",
    title: "Arrival",
    type: "movie",
    labels: [],
    librarySectionID: 1,
    ...over,
  }) as never;

const hub = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    key: "/hubs/x",
    title: "Recently Added",
    context: "hub.movie.recentlyadded",
    hubIdentifier: "movie.recentlyadded",
    items: [],
    ...over,
  }) as never;

describe("parseLabelFilter", () => {
  test("an empty filter means no clauses, which means no filtering", () => {
    assert.deepEqual(parseLabelFilter(""), []);
  });

  test("a single label is one clause of one option", () => {
    assert.deepEqual(parseLabelFilter("Kids"), [["Kids"]]);
  });

  test("a comma is AND — every clause must match", () => {
    assert.deepEqual(parseLabelFilter("Kids,Family"), [["Kids"], ["Family"]]);
  });

  test("a pipe is OR — any option within a clause matches", () => {
    assert.deepEqual(parseLabelFilter("Kids|Family"), [["Kids", "Family"]]);
  });

  test("the two combine, AND of ORs", () => {
    assert.deepEqual(parseLabelFilter("Kids|Family,Safe"), [["Kids", "Family"], ["Safe"]]);
  });

  test("a `label=` prefix is stripped", () => {
    assert.deepEqual(parseLabelFilter("label=Kids"), [["Kids"]]);
    assert.deepEqual(parseLabelFilter("label=Kids|Family"), [["Kids", "Family"]]);
  });

  test("only the first `=` is treated as the prefix separator", () => {
    // A label may legitimately contain `=`. Splitting on every one would
    // truncate it and quietly widen the filter.
    assert.deepEqual(parseLabelFilter("label=a=b"), [["a=b"]]);
  });

  test("whitespace around labels is trimmed", () => {
    assert.deepEqual(parseLabelFilter(" Kids , Family "), [["Kids"], ["Family"]]);
    assert.deepEqual(parseLabelFilter("Kids | Family"), [["Kids", "Family"]]);
  });

  test("empty clauses and options are dropped rather than becoming match-nothing", () => {
    // `a,,b` and `a||b` come from a filter someone edited by hand. An empty
    // clause that survived would match nothing and hide the whole library.
    assert.deepEqual(parseLabelFilter("Kids,,Family"), [["Kids"], ["Family"]]);
    assert.deepEqual(parseLabelFilter("Kids||Family"), [["Kids", "Family"]]);
    assert.deepEqual(parseLabelFilter(",,,"), []);
    assert.deepEqual(parseLabelFilter("label="), []);
  });
});

describe("itemPassesLabelFilter", () => {
  test("no clauses means everything passes", () => {
    assert.equal(itemPassesLabelFilter(item({ labels: [] }), []), true);
  });

  test("a single clause requires one of its options", () => {
    const clauses = parseLabelFilter("Kids|Family");
    assert.equal(itemPassesLabelFilter(item({ labels: ["Kids"] }), clauses), true);
    assert.equal(itemPassesLabelFilter(item({ labels: ["Family"] }), clauses), true);
    assert.equal(itemPassesLabelFilter(item({ labels: ["Horror"] }), clauses), false);
  });

  test("every clause must be satisfied", () => {
    const clauses = parseLabelFilter("Kids,Safe");
    assert.equal(itemPassesLabelFilter(item({ labels: ["Kids", "Safe"] }), clauses), true);
    assert.equal(itemPassesLabelFilter(item({ labels: ["Kids"] }), clauses), false);
  });

  test("matching is case-insensitive on both sides", () => {
    // Plex does not normalise label case, and neither do users.
    const clauses = parseLabelFilter("kids");
    assert.equal(itemPassesLabelFilter(item({ labels: ["KIDS"] }), clauses), true);
    assert.equal(itemPassesLabelFilter(item({ labels: ["Kids"] }), parseLabelFilter("KIDS")), true);
  });

  test("an item with no labels fails any real filter", () => {
    assert.equal(itemPassesLabelFilter(item({ labels: [] }), parseLabelFilter("Kids")), false);
  });
});

describe("isPersonalProgressHub", () => {
  test("recognises Continue Watching however Plex spells it", () => {
    // Several Plex versions, several spellings. Missing one shows the admin's
    // own half-watched films as though they were the user's.
    for (const h of [
      hub({ context: "hub.continueWatching" }),
      hub({ context: "hub.continue.watching" }),
      hub({ context: "hub.continue_watching" }),
      hub({ context: "", hubIdentifier: "home.continueWatching" }),
      hub({ context: "", hubIdentifier: "", title: "Continue Watching" }),
    ]) {
      assert.equal(isPersonalProgressHub(h), true, JSON.stringify(h));
    }
  });

  test("recognises On Deck", () => {
    for (const h of [
      hub({ context: "hub.ondeck" }),
      hub({ context: "", hubIdentifier: "home.onDeck" }),
      hub({ context: "", hubIdentifier: "", title: "On Deck" }),
    ]) {
      assert.equal(isPersonalProgressHub(h), true, JSON.stringify(h));
    }
  });

  test("an ordinary hub is not personal", () => {
    for (const h of [
      hub({ context: "hub.movie.recentlyadded", hubIdentifier: "movie.recentlyadded", title: "Recently Added" }),
      hub({ context: "hub.movie.toprated", hubIdentifier: "movie.toprated", title: "Top Rated" }),
      hub({ context: "", hubIdentifier: "", title: "Sci-Fi Gems" }),
    ]) {
      assert.equal(isPersonalProgressHub(h), false, JSON.stringify(h));
    }
  });

  test("missing fields do not throw", () => {
    assert.equal(isPersonalProgressHub(hub({ context: undefined, hubIdentifier: undefined, title: undefined })), false);
  });
});

describe("getPreviewForUser", () => {
  function client(over: Partial<Record<string, unknown>> = {}): PlexClient {
    return {
      getHomeHubs: async () => [hub({ items: [item()] })],
      getIdentity: async () => ({ machineIdentifier: "machine-1" }),
      getSharings: async () => [{ userId: 7, username: "sam" }],
      getSharedServerDetails: async () => [
        { userId: 7, librarySectionIds: [1], filterMovies: "", filterTelevision: "" },
      ],
      ...over,
    } as unknown as PlexClient;
  }

  test("with no user, hubs come back unfiltered and unwarned", async () => {
    const result = await getPreviewForUser(client(), null);
    assert.equal(result.user, null);
    assert.equal(result.hubs.length, 1);
    assert.deepEqual(result.warnings, []);
  });

  test("a shared user's hubs are filtered to their libraries", async () => {
    const result = await getPreviewForUser(
      client({
        getHomeHubs: async () => [
          hub({ items: [item({ ratingKey: "1" }), item({ ratingKey: "2", librarySectionID: 9 })] }),
        ],
      }),
      7,
    );

    assert.equal(result.user?.username, "sam");
    assert.deepEqual(
      result.hubs[0]?.items.map((i) => i.ratingKey),
      ["1"],
      "the item in an unshared library was dropped",
    );
  });

  test("label filters are applied per media type", async () => {
    const result = await getPreviewForUser(
      client({
        getHomeHubs: async () => [
          hub({
            items: [
              item({ ratingKey: "kid-movie", type: "movie", labels: ["Kids"] }),
              item({ ratingKey: "adult-movie", type: "movie", labels: ["Horror"] }),
              // A show is filtered by `filterTelevision`, which is empty here.
              item({ ratingKey: "any-show", type: "show", labels: ["Horror"] }),
            ],
          }),
        ],
        getSharedServerDetails: async () => [
          { userId: 7, librarySectionIds: [1], filterMovies: "label=Kids", filterTelevision: "" },
        ],
      }),
      7,
    );

    assert.deepEqual(
      result.hubs[0]?.items.map((i) => i.ratingKey),
      ["kid-movie", "any-show"],
    );
  });

  test("an unknown user gets unfiltered hubs AND a warning saying so", async () => {
    // The dangerous branch: the admin is shown their own view. Without the
    // warning it looks like a successful preview of somebody else's screen.
    const result = await getPreviewForUser(client({ getSharings: async () => [] }), 7);

    assert.equal(result.user, null);
    assert.equal(result.hubs.length, 1, "hubs are shown");
    assert.match(result.warnings.join(" "), /not found in sharings/);
    assert.match(result.warnings.join(" "), /unfiltered/);
  });

  test("a user with no SharedServer record is shown everything, with a warning", async () => {
    const result = await getPreviewForUser(client({ getSharedServerDetails: async () => [] }), 7);

    assert.equal(result.user?.userId, 7);
    assert.match(result.warnings.join(" "), /without label filtering/);
  });

  test("personal-progress hubs are dropped, and the reason is reported", async () => {
    const result = await getPreviewForUser(
      client({
        getHomeHubs: async () => [
          hub({ context: "hub.continueWatching", items: [item()] }),
          hub({ items: [item({ ratingKey: "2" })] }),
        ],
      }),
      7,
    );

    assert.equal(result.hubs.length, 1);
    assert.match(result.warnings.join(" "), /Continue Watching/);
  });

  test("a hub left with no items is dropped rather than shown empty", async () => {
    const result = await getPreviewForUser(
      client({
        getHomeHubs: async () => [hub({ items: [item({ librarySectionID: 99 })] })],
      }),
      7,
    );

    assert.deepEqual(result.hubs, []);
  });

  test("a section filter narrows further still", async () => {
    const result = await getPreviewForUser(
      client({
        getHomeHubs: async () => [
          hub({
            items: [item({ ratingKey: "1", librarySectionID: 1 }), item({ ratingKey: "2", librarySectionID: 1 })],
          }),
        ],
        getSharedServerDetails: async () => [
          { userId: 7, librarySectionIds: [1, 2], filterMovies: "", filterTelevision: "" },
        ],
      }),
      7,
      2,
    );

    assert.deepEqual(result.hubs, [], "nothing in section 2");
  });
});

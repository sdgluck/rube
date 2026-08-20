/**
 * The wizard's validation engine — 648 lines deciding whether a rule may be
 * saved, of which `pin-steps.test.ts` covered the pinning slice.
 *
 * Both directions cost something real. A false *negative* blocks a rule the
 * user is entitled to save, with a message pointing at a step that looks fine.
 * A false *positive* writes a config the server then has to cope with: a
 * metadata rule that sets nothing runs nightly, matches a thousand items, does
 * nothing, and leaves no evidence but a log nobody reads; a cleanup rule with
 * `consecutiveRuns: 1` deletes on first sight, which is the one thing the
 * streak exists to prevent.
 *
 * Pure functions over a plain object, so no DOM and no new dependencies — the
 * wizard's rendering is out of scope here by design.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  arrServiceForType,
  defaultLimitForType,
  isFormValid,
  presentationError,
  requiredSectionTypeForRule,
  ruleTypesFor,
  suggestName,
  typeHasLimit,
  typeHasOptionalLimit,
  validateStep,
} from "./rule-types.ts";
import { DEFAULT_OUTCOME_FORM, DEFAULT_PRESENTATION_FORM, type RuleFormState } from "./types.ts";

/**
 * Only the slices the validators read. Importing the wizard's own `EMPTY_FORM`
 * would drag the component tree in behind it — the same reasoning as
 * `pin-steps.test.ts`.
 */
const form = (over: Partial<RuleFormState> = {}): RuleFormState =>
  ({
    name: "My Rule",
    type: "directors",
    themes: [],
    customThemes: [],
    limit: 0,
    minItems: 0,
    sections: ["1"],
    chart: "",
    listId: "",
    listProvider: "mdblist",
    collectionName: "",
    smartFilter: { kind: "group", op: "and", children: [] },
    filter: "all",
    pinToHomepage: false,
    pinRotationCount: 0,
    pinMinItems: 0,
    outcome: { ...DEFAULT_OUTCOME_FORM },
    presentation: { ...DEFAULT_PRESENTATION_FORM },
    arr: {
      enabled: false,
      instanceId: "",
      monitor: true,
      searchOnAdd: true,
      qualityProfileId: 0,
      rootFolderPath: "",
      maxAddsPerRun: 10,
      dryRun: true,
    },
    ...over,
  }) as RuleFormState;

describe("validateStep — type", () => {
  it("requires a type", () => {
    assert.match(validateStep("type", form({ type: "" })) ?? "", /Pick a rule type/);
    assert.equal(validateStep("type", form()), null);
  });
});

describe("validateStep — source", () => {
  it("an AI rule needs at least one theme, custom or not", () => {
    const ai = form({ type: "ai_prompt" });
    assert.match(validateStep("source", ai) ?? "", /theme/i);
    assert.equal(validateStep("source", form({ type: "ai_prompt", themes: ["heist"] })), null);
    assert.equal(validateStep("source", form({ type: "ai_prompt", customThemes: ["slow cinema"] })), null);
  });

  it("an IMDb list rule needs a list id", () => {
    assert.match(validateStep("source", form({ type: "imdb_list" })) ?? "", /list ID/i);
    assert.match(validateStep("source", form({ type: "imdb_list", listId: "   " })) ?? "", /list ID/i);
    assert.equal(validateStep("source", form({ type: "imdb_list", listId: "ls123" })), null);
  });

  it("a list-source rule needs both a provider and an id", () => {
    assert.match(validateStep("source", form({ type: "list_source", listProvider: "" as never })) ?? "", /provider/i);
    assert.match(validateStep("source", form({ type: "list_source", listId: "" })) ?? "", /list ID/i);
    assert.equal(validateStep("source", form({ type: "list_source", listProvider: "trakt", listId: "x" })), null);
  });

  it("a smart filter needs at least one complete clause", () => {
    const empty = form({ type: "smart_filter" });
    assert.match(validateStep("source", empty) ?? "", /at least one filter clause/i);

    const halfWritten = form({
      type: "smart_filter",
      smartFilter: {
        kind: "group",
        op: "and",
        children: [{ kind: "leaf", field: "genre", operator: "is", value: "" }],
      } as never,
    });
    assert.match(validateStep("source", halfWritten) ?? "", /field and value/i);

    const complete = form({
      type: "smart_filter",
      smartFilter: {
        kind: "group",
        op: "and",
        children: [{ kind: "leaf", field: "genre", operator: "is", value: "Sci-Fi" }],
      } as never,
    });
    assert.equal(validateStep("source", complete), null);
  });

  it("a type with no source requirements passes", () => {
    assert.equal(validateStep("source", form({ type: "directors" })), null);
  });
});

describe("validateStep — outcome", () => {
  it("a cleanup rule must say what happens", () => {
    const noMode = form({ outcome: { ...DEFAULT_OUTCOME_FORM, kind: "cleanup", mode: "" as never } });
    assert.match(validateStep("outcome", noMode) ?? "", /what should happen/i);
  });

  it("a destructive cleanup rule cannot act on a single run", () => {
    // The streak is the whole safety story: one bad night of Plex metadata
    // should not be able to delete anything.
    const oneRun = form({
      outcome: { ...DEFAULT_OUTCOME_FORM, kind: "cleanup", mode: "delete", consecutiveRuns: 1 },
    });
    assert.match(validateStep("outcome", oneRun) ?? "", /at least two consecutive/i);

    const twoRuns = form({
      outcome: { ...DEFAULT_OUTCOME_FORM, kind: "cleanup", mode: "delete", consecutiveRuns: 2 },
    });
    assert.equal(validateStep("outcome", twoRuns), null);
  });

  it("a non-destructive cleanup rule may act on the first run", () => {
    // Labelling something is reversible, so the two-run floor would just be in
    // the way.
    const labelOnce = form({
      outcome: { ...DEFAULT_OUTCOME_FORM, kind: "cleanup", mode: "label", consecutiveRuns: 1 },
    });
    assert.equal(validateStep("outcome", labelOnce), null);
  });

  it("a cleanup rule needs a per-run limit of at least one", () => {
    const noLimit = form({
      outcome: { ...DEFAULT_OUTCOME_FORM, kind: "cleanup", mode: "label", maxActionsPerRun: 0 },
    });
    assert.match(validateStep("outcome", noLimit) ?? "", /at least one item/i);
  });

  it("a collection rule has no outcome constraints", () => {
    assert.equal(validateStep("outcome", form()), null);
  });
});

describe("presentationError", () => {
  it("a custom summary must actually be written", () => {
    const blank = form({ presentation: { ...DEFAULT_PRESENTATION_FORM, summary: "custom", customSummary: "  " } });
    assert.match(presentationError(blank) ?? "", /Write the summary/);
  });

  it("a URL poster needs a URL", () => {
    const none = form({ presentation: { ...DEFAULT_PRESENTATION_FORM, poster: "url", posterUrl: "" } });
    assert.match(presentationError(none) ?? "", /poster URL is required/i);
  });

  it("a poster URL must pass the same allow-list the server applies", () => {
    // This host is fetched on a schedule by the server, so the check is not a
    // convenience — it is the same one the registry build applies.
    const insecure = form({
      presentation: { ...DEFAULT_PRESENTATION_FORM, poster: "url", posterUrl: "http://example.com/p.jpg" },
    });
    assert.ok(presentationError(insecure), "plain http was accepted");
  });

  it("an accent colour must be a hex triplet", () => {
    const bad = form({ presentation: { ...DEFAULT_PRESENTATION_FORM, accentColor: "goldenrod" } });
    assert.match(presentationError(bad) ?? "", /hex colour/i);

    for (const accentColor of ["#E5A00D", "#fff", "#ABC", ""]) {
      assert.equal(
        presentationError(form({ presentation: { ...DEFAULT_PRESENTATION_FORM, accentColor } })),
        null,
        accentColor,
      );
    }
  });

  it("does not apply to a rule that produces no collection", () => {
    // A cleanup rule has no presentation, so a stale value left in the form
    // from a type switch must not block the save.
    const cleanup = form({
      outcome: { ...DEFAULT_OUTCOME_FORM, kind: "cleanup", mode: "label" },
      presentation: { ...DEFAULT_PRESENTATION_FORM, summary: "custom", customSummary: "" },
    });
    assert.equal(presentationError(cleanup), null);
  });
});

describe("validateStep — actions and review", () => {
  it("an *Arr action needs a quality profile and a root folder", () => {
    const enabled = form({ arr: { ...form().arr, enabled: true } });
    assert.match(validateStep("actions", enabled) ?? "", /quality profile/i);

    const withProfile = form({ arr: { ...form().arr, enabled: true, qualityProfileId: 1 } });
    assert.match(validateStep("actions", withProfile) ?? "", /root folder/i);

    const complete = form({ arr: { ...form().arr, enabled: true, qualityProfileId: 1, rootFolderPath: "/data" } });
    assert.equal(validateStep("actions", complete), null);
  });

  it("a disabled *Arr action needs nothing", () => {
    assert.equal(validateStep("actions", form()), null);
  });

  it("review requires a name", () => {
    assert.match(validateStep("review", form({ name: "  " })) ?? "", /Name is required/);
    assert.equal(validateStep("review", form()), null);
  });
});

describe("isFormValid", () => {
  it("accepts a complete rule", () => {
    assert.equal(isFormValid(form()), true);
  });

  it("refuses a rule with no name or no type", () => {
    assert.equal(isFormValid(form({ name: "" })), false);
    assert.equal(isFormValid(form({ name: "   " })), false);
    assert.equal(isFormValid(form({ type: "" })), false);
  });

  it("agrees with the per-step validators about each type's source requirement", () => {
    // The two run at different moments — steps as you move through, this on
    // every keystroke to enable Save. Disagreement is how a rule ends up
    // saveable with a step still showing an error.
    const cases: RuleFormState[] = [
      form({ type: "ai_prompt" }),
      form({ type: "imdb_list" }),
      form({ type: "list_source" }),
      form({ type: "smart_filter" }),
    ];
    for (const candidate of cases) {
      assert.equal(isFormValid(candidate), false, `${candidate.type} was saveable with an incomplete source`);
      assert.ok(validateStep("source", candidate), `${candidate.type} passed its source step`);
    }
  });

  it("refuses a rule whose presentation is invalid", () => {
    const bad = form({ presentation: { ...DEFAULT_PRESENTATION_FORM, accentColor: "nope" } });
    assert.equal(isFormValid(bad), false);
  });

  it("refuses a half-configured *Arr action", () => {
    assert.equal(isFormValid(form({ arr: { ...form().arr, enabled: true } })), false);
    assert.equal(
      isFormValid(form({ arr: { ...form().arr, enabled: true, qualityProfileId: 1, rootFolderPath: "/d" } })),
      true,
    );
  });
});

describe("type metadata", () => {
  it("ruleTypesFor narrows to the chosen outcome, and never returns nothing", () => {
    for (const kind of ["collection", "cleanup", "metadata", "playlist"] as const) {
      const types = ruleTypesFor(kind);
      assert.ok(types.length > 0, `${kind} offered no rule types`);
      assert.equal(new Set(types.map((t) => t.value)).size, types.length, `${kind} offered a duplicate`);
    }
  });

  it("a limit default is only offered where a limit exists", () => {
    // A default for a type with no limit field is dead config that ships in
    // every saved rule.
    for (const type of ["ai_prompt", "top_rated", "rt_top_rated", "seerr_requests", "tmdb_franchises"]) {
      assert.ok(typeHasLimit(type), `${type} has a default but no limit field`);
      assert.ok(defaultLimitForType(type) > 0, `${type} has a limit field but no sensible default`);
    }
  });

  it("grouped rules default to no cap, and render it as opt-in", () => {
    assert.equal(defaultLimitForType("directors"), 0, "0 means no cap");
    assert.equal(typeHasOptionalLimit("directors"), true);
    assert.equal(typeHasOptionalLimit("top_rated"), false);
  });

  it("section-type constraints follow the type, and the chart where it matters", () => {
    assert.equal(requiredSectionTypeForRule("networks", ""), "show");
    assert.equal(requiredSectionTypeForRule("tmdb_franchises", ""), "movie");
    assert.equal(requiredSectionTypeForRule("directors", ""), undefined, "no constraint");
  });

  it("the *Arr service follows the section type an imdb chart implies", () => {
    // Sending a TV chart to Radarr adds nothing and reports no error, which is
    // the worst shape a bug can take.
    assert.equal(arrServiceForType("imdb_chart", "top_250_tv"), "sonarr");
    assert.equal(arrServiceForType("imdb_chart", "top_250_movies"), "radarr");
    assert.equal(arrServiceForType("imdb_list", ""), "radarr", "mixed lists default to radarr");
  });

  it("suggestName produces a non-empty name for every rule type", () => {
    // It fills the name field, and an empty name fails `isFormValid` — so a
    // type that produced nothing left Save disabled with nothing saying why.
    // Ten of the twenty-nine types did exactly that until the grouped fallback
    // was derived from `groupNounForType` rather than hand-listed.
    for (const kind of ["collection", "cleanup", "metadata", "playlist"] as const) {
      for (const type of ruleTypesFor(kind)) {
        const name = suggestName(form({ type: type.value }), [{ title: "Movies" }]);
        assert.equal(typeof name, "string");
        assert.ok(name.trim().length > 0, `${type.value} suggested an empty name`);
      }
    }
  });

  it("the names that already existed are unchanged", () => {
    // The fallback has to reproduce the seven hand-written cases exactly, or
    // deriving it would silently rename rules people recognise.
    const expected: Record<string, string> = {
      actors: "By Actor",
      directors: "By Director",
      studios: "By Studio",
      networks: "By Network",
      genres: "By Genre",
      countries: "By Country",
      content_ratings: "By Content Rating",
      tmdb_popular_actors: "Popular Actors",
      tmdb_popular_directors: "Popular Directors",
      tmdb_franchises: "Franchises",
      top_rated: "Top Rated",
      lowest_rated: "Lowest Rated",
      rt_top_rated: "Rotten Tomatoes Top Rated",
    };
    for (const [type, name] of Object.entries(expected)) {
      assert.equal(suggestName(form({ type }), []), name);
    }
  });

  it("the newly-covered types read the way the others do", () => {
    assert.equal(suggestName(form({ type: "decades" }), []), "By Decade");
    assert.equal(suggestName(form({ type: "years" }), []), "By Year");
    assert.equal(suggestName(form({ type: "audio_languages" }), []), "By Audio Language");
    assert.equal(suggestName(form({ type: "streaming" }), []), "By Streaming Service");
  });
});

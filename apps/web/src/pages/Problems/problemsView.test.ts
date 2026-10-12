import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterKindRows, summariseKinds, type ProblemLike } from "./problemsView.ts";

const row = (over: Partial<ProblemLike> & Pick<ProblemLike, "kind" | "subject">): ProblemLike => ({
  title: over.subject,
  detail: "",
  dismissed: false,
  fixable: false,
  ...over,
});

describe("summariseKinds", () => {
  it("counts open, dismissed and fixable rows, faults before advisories", () => {
    const summary = summariseKinds([
      row({ kind: "inPlexNotInArr", subject: "a" }),
      row({ kind: "episodeOrdering", subject: "b", fixable: true }),
      row({ kind: "episodeOrdering", subject: "c", fixable: true, fixPending: true }),
      row({ kind: "episodeOrdering", subject: "d", fixable: true, dismissed: true }),
    ]);
    assert.deepEqual(summary, [
      { kind: "episodeOrdering", severity: "fault", open: 2, dismissed: 1, fixableOpen: 1 },
      { kind: "inPlexNotInArr", severity: "advisory", open: 1, dismissed: 0, fixableOpen: 0 },
    ]);
  });

  it("keeps a kind whose every row is dismissed, so its dismissals can be undone", () => {
    const summary = summariseKinds([row({ kind: "unmatched", subject: "a", dismissed: true })]);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].open, 0);
  });
});

describe("filterKindRows", () => {
  const rows = [
    row({ kind: "unmatched", subject: "1", title: "Alien", detail: "Movies" }),
    row({ kind: "unmatched", subject: "2", title: "Aliens", detail: "Movies", dismissed: true }),
    row({ kind: "unmatched", subject: "3", title: "Heat", detail: "4K movies" }),
    row({ kind: "legacyAgent", subject: "4", title: "Alien", detail: "" }),
  ];
  const subjects = (r: ProblemLike[]) => r.map((p) => p.subject);

  it("keeps to one kind and splits open from dismissed", () => {
    assert.deepEqual(subjects(filterKindRows(rows, "unmatched", { q: "", show: "open" })), ["1", "3"]);
    assert.deepEqual(subjects(filterKindRows(rows, "unmatched", { q: "", show: "dismissed" })), ["2"]);
    assert.deepEqual(subjects(filterKindRows(rows, "unmatched", { q: "", show: "all" })), ["1", "2", "3"]);
  });

  it("searches title and detail, ignoring case", () => {
    assert.deepEqual(subjects(filterKindRows(rows, "unmatched", { q: " ALIEN ", show: "all" })), ["1", "2"]);
    assert.deepEqual(subjects(filterKindRows(rows, "unmatched", { q: "4k", show: "all" })), ["3"]);
  });
});

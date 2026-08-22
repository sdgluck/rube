/**
 * The chart maths. Rendering is the screenshot harness's job; these are the
 * decisions a chart can get *wrong* — a line drawn through a reading nobody
 * took, an axis that hides the threshold the run is judged against, a tooltip
 * that reads out the wrong sample.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bandPath,
  bandwidthAxis,
  formatOffset,
  lanes,
  linePath,
  nearestIndex,
  niceScale,
  phaseRuns,
  projectY,
} from "./chart.ts";
import type { StressSample } from "./types.ts";

function sample(over: Partial<StressSample> = {}): StressSample {
  return {
    t: 0,
    step: 1,
    phase: "measure",
    started: 1,
    seen: 1,
    speed: 2,
    speedMin: 2,
    kbps: 1000,
    actualKbps: 900,
    ok: 1,
    err: 0,
    notReady: 0,
    apiError: false,
    sessions: [],
    ...over,
  };
}

describe("niceScale", () => {
  it("cuts the axis on numbers a person would have chosen", () => {
    const scale = niceScale([0, 47, 92]);
    assert.ok(scale.ticks.every((t) => Number.isInteger(t / 25) || Number.isInteger(t)));
    assert.equal(scale.min, 0);
    assert.ok(scale.max >= 92);
  });

  it("keeps forced values in range", () => {
    // The speed chart is read against 1.0x. An axis that ran 2.0–8.0 because
    // the server never dipped would hide the only line that matters.
    const scale = niceScale([4, 6, 8], { include: [0, 1] });
    assert.equal(scale.min, 0);
  });

  it("gives a flat series a range instead of one pixel row", () => {
    // A steady 40 Mbps and a steady 4 Mbps must not draw the same picture.
    const scale = niceScale([40, 40, 40]);
    assert.ok(scale.max > scale.min);
  });

  it("survives having nothing to scale", () => {
    const scale = niceScale([]);
    assert.ok(scale.max > scale.min);
    assert.ok(scale.ticks.length >= 2);
  });

  it("does not label a tick 0.30000000000000004", () => {
    const scale = niceScale([0, 1], { include: [0] });
    for (const tick of scale.ticks) assert.equal(tick, Number(tick.toPrecision(12)));
  });

  it("ignores a non-finite reading rather than collapsing the axis", () => {
    const scale = niceScale([10, Number.NaN, 20, Number.POSITIVE_INFINITY]);
    assert.ok(Number.isFinite(scale.min) && Number.isFinite(scale.max));
    assert.ok(scale.max >= 20);
  });
});

describe("projectY", () => {
  it("puts the maximum at the top edge and the minimum at the bottom", () => {
    const scale = { min: 0, max: 10, ticks: [0, 5, 10] };
    assert.equal(projectY(10, scale, 100), 0);
    assert.equal(projectY(0, scale, 100), 100);
    assert.equal(projectY(5, scale, 100), 50);
  });
});

describe("linePath", () => {
  it("breaks the line where there is no reading", () => {
    // A null is not a zero. Direct play has no transcode speed at all, and
    // drawing it as a dip to the floor invents the stall the chart exists to
    // show.
    const d = linePath([
      { x: 0, y: 10 },
      { x: 1, y: null },
      { x: 2, y: 20 },
    ]);
    assert.equal((d.match(/M/g) ?? []).length, 2, "expected two subpaths");
  });

  it("draws nothing at all from nothing at all", () => {
    assert.equal(linePath([{ x: 0, y: null }]), "");
  });

  it("joins consecutive readings into one stroke", () => {
    const d = linePath([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
    ]);
    assert.equal((d.match(/M/g) ?? []).length, 1);
    assert.equal((d.match(/L/g) ?? []).length, 2);
  });
});

describe("bandPath", () => {
  it("closes a filled span only where both edges were measured", () => {
    const d = bandPath([
      { x: 0, hi: 10, lo: 5 },
      { x: 1, hi: 12, lo: 4 },
      { x: 2, hi: null, lo: null },
      { x: 3, hi: 8, lo: 6 },
      { x: 4, hi: 9, lo: 5 },
    ]);
    assert.equal((d.match(/Z/g) ?? []).length, 2);
  });

  it("does not fill a single point", () => {
    // One reading has no span. A degenerate polygon renders as a hairline that
    // reads like a spike.
    assert.equal(bandPath([{ x: 0, hi: 10, lo: 5 }]), "");
  });
});

describe("nearestIndex", () => {
  const times = [0, 1000, 2000, 3000];

  it("finds the sample under the pointer", () => {
    assert.equal(nearestIndex(times, 1100), 1);
    assert.equal(nearestIndex(times, 1600), 2);
  });

  it("still reads out past the newest sample", () => {
    // A live run's newest data is at the right-hand edge, which is exactly
    // where a "last one before" lookup would blank out.
    assert.equal(nearestIndex(times, 9999), 3);
  });

  it("settles on one sample rather than flickering between two", () => {
    assert.equal(nearestIndex(times, 500), 0);
  });

  it("reports nothing to point at when there is nothing", () => {
    assert.equal(nearestIndex([], 100), -1);
  });
});

describe("phaseRuns", () => {
  it("leaves no gap between one phase and the next", () => {
    // Sampling is periodic, so the boundary happened somewhere between two
    // readings. Attributing it to either is equally wrong; a hole is visibly so.
    const runs = phaseRuns([
      sample({ t: 0, phase: "settle" }),
      sample({ t: 100, phase: "settle" }),
      sample({ t: 200, phase: "measure" }),
      sample({ t: 300, phase: "measure" }),
    ]);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].to, runs[1].from);
  });

  it("splits a phase that repeats at a new step", () => {
    // Two consecutive settles at different session counts are two settles.
    const runs = phaseRuns([sample({ t: 0, phase: "settle", step: 1 }), sample({ t: 100, phase: "settle", step: 2 })]);
    assert.equal(runs.length, 2);
    assert.deepEqual(
      runs.map((r) => r.step),
      [1, 2],
    );
  });

  it("has nothing to show before the first sample", () => {
    assert.deepEqual(phaseRuns([]), []);
  });
});

describe("lanes", () => {
  const series = [
    sample({ t: 0, sessions: [{ id: "a", speed: 4, kbps: 100, decision: "transcode" }] }),
    sample({
      t: 1000,
      sessions: [
        { id: "a", speed: 3, kbps: 120, decision: "transcode" },
        { id: "b", speed: 3, kbps: 200, decision: "transcode", hw: true },
      ],
    }),
    sample({ t: 2000, sessions: [{ id: "b", speed: 2, kbps: 220, decision: "transcode", hw: true }] }),
  ];

  it("keeps a session that has ended, marked dead", () => {
    // The ramp's own cleanup ends every session. A panel that empties itself
    // at the end of a run destroys the record of what the run did.
    const out = lanes(series);
    assert.deepEqual(
      out.map((l) => l.id),
      ["a", "b"],
    );
    assert.equal(out.find((l) => l.id === "a")!.live, false);
    assert.equal(out.find((l) => l.id === "b")!.live, true);
  });

  it("orders lanes by when the ramp started them", () => {
    assert.equal(lanes(series)[0].id, "a");
  });

  it("carries each session's latest reading and its recent shape", () => {
    const b = lanes(series).find((l) => l.id === "b")!;
    assert.equal(b.kbps, 220);
    assert.equal(b.speed, 2);
    assert.equal(b.hw, true);
    assert.deepEqual(b.speeds, [3, 2]);
  });

  it("keeps a session's identity when a reading is missing its speed", () => {
    // Direct play reports no speed at all; the lane still exists and still
    // has bandwidth to show.
    const out = lanes([sample({ sessions: [{ id: "d", speed: null, kbps: 9000, decision: "directplay" }] })]);
    assert.equal(out.length, 1);
    assert.equal(out[0].speed, null);
    assert.equal(out[0].kbps, 9000);
  });
});

describe("bandwidthAxis", () => {
  it("gives every tick on one axis the same unit", () => {
    // Per-value unit switching is right for a single figure and wrong for a
    // column of them: 0 kbps above 20.0 Mbps makes the reader check whether the
    // bottom tick is a thousandth of the next one.
    const axis = bandwidthAxis(60_000);
    assert.deepEqual([0, 20_000, 60_000].map(axis), ["0 Mbps", "20 Mbps", "60 Mbps"]);
  });

  it("stays in kbps for a scale that never leaves it", () => {
    const axis = bandwidthAxis(800);
    assert.deepEqual([0, 400, 800].map(axis), ["0 kbps", "400 kbps", "800 kbps"]);
  });

  it("keeps a decimal where the scale is small enough to need one", () => {
    assert.equal(bandwidthAxis(4000)(1500), "1.5 Mbps");
  });
});

describe("formatOffset", () => {
  it("reads as elapsed time, not a timestamp", () => {
    assert.equal(formatOffset(0), "0:00");
    assert.equal(formatOffset(9_000), "0:09");
    assert.equal(formatOffset(125_000), "2:05");
  });

  it("does not render a negative clock", () => {
    assert.equal(formatOffset(-500), "0:00");
  });
});

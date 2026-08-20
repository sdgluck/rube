import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatCustomFormatScore, seriesProgress, arrAddTargetSchema } from "./arr.ts";

describe("formatBytes", () => {
  it("renders the usual sizes", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1024), "1.0 KB");
    assert.equal(formatBytes(1024 * 1024 * 1536), "1.5 GB");
  });

  it("drops the decimal once the number is big enough not to need it", () => {
    assert.equal(formatBytes(1024 * 1024 * 1024 * 12), "12 GB");
  });

  // Null is "unknown", never zero — a storage total would happily add zero up.
  it("renders unknown rather than zero", () => {
    assert.equal(formatBytes(null), "—");
    assert.equal(formatBytes(undefined), "—");
  });
});

describe("formatCustomFormatScore", () => {
  // The sign is the whole meaning: a negative score is a format being penalised.
  it("always shows the sign", () => {
    assert.equal(formatCustomFormatScore(50), "+50");
    assert.equal(formatCustomFormatScore(-100), "-100");
    assert.equal(formatCustomFormatScore(0), "0");
  });

  it("renders unknown", () => {
    assert.equal(formatCustomFormatScore(null), "—");
  });
});

describe("seriesProgress", () => {
  it("is a fraction of episodes on disk", () => {
    assert.equal(seriesProgress(5, 10), 0.5);
    assert.equal(seriesProgress(10, 10), 1);
  });

  // A show can hold more files than Sonarr counts episodes for; the bar must
  // not overflow because somebody has a bonus disc.
  it("clamps above one", () => {
    assert.equal(seriesProgress(12, 10), 1);
  });

  it("is unknown when the episode count is not", () => {
    assert.equal(seriesProgress(0, 0), null);
  });
});

describe("arrAddTargetSchema", () => {
  it("accepts a target with no instance, meaning the default", () => {
    const parsed = arrAddTargetSchema.parse({
      service: "radarr",
      qualityProfileId: 4,
      rootFolderPath: "/movies",
      monitor: true,
      searchOnAdd: true,
    });
    assert.equal(parsed.instanceId, undefined);
  });

  it("rejects a service it does not know", () => {
    assert.throws(() =>
      arrAddTargetSchema.parse({
        service: "lidarr",
        qualityProfileId: 4,
        rootFolderPath: "/music",
        monitor: true,
        searchOnAdd: true,
      }),
    );
  });
});

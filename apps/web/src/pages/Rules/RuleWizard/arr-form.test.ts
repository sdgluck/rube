import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { arrConfigFromForm, arrFormFromConfig } from "./arr-form.ts";

const shared = { enabled: true, monitor: true, searchOnAdd: false, maxAddsPerRun: 25, dryRun: true };

describe("arr form ↔ config", () => {
  it("reads a single-target rule as the service the wizard showed for its type", () => {
    const legacy = { ...shared, qualityProfileId: 3, rootFolderPath: "/movies" };
    const list = arrFormFromConfig(legacy, "imdb_list", "");
    assert.equal(list.radarr.qualityProfileId, 3);
    assert.equal(list.sonarr.qualityProfileId, 0, "a Radarr profile id is not a Sonarr one");

    const tvChart = arrFormFromConfig({ ...legacy, rootFolderPath: "/tv" }, "imdb_chart", "top_250_tv");
    assert.equal(tvChart.sonarr.rootFolderPath, "/tv");
    assert.equal(tvChart.radarr.rootFolderPath, "");
  });

  it("writes a target per service in scope, and drops the rest", () => {
    const form = arrFormFromConfig(
      {
        ...shared,
        radarr: { qualityProfileId: 1, rootFolderPath: "/movies" },
        sonarr: { instanceId: "4k", qualityProfileId: 2, rootFolderPath: "/tv" },
      },
      "seerr_requests",
      "",
    );
    assert.deepEqual(arrConfigFromForm({ ...form, services: ["sonarr"] }), {
      ...shared,
      sonarr: { instanceId: "4k", qualityProfileId: 2, rootFolderPath: "/tv" },
    });
  });

  it("writes nothing for a disabled action", () => {
    assert.equal(arrConfigFromForm({ ...arrFormFromConfig(undefined, "imdb_list", ""), enabled: false }), undefined);
  });
});

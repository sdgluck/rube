/**
 * The whole design of split instances rests on one promise: an install that
 * never configures a second instance, and a rule that never names one, behave
 * exactly as they did before any of this existed. These pin that promise, and
 * the ways it could quietly be broken — a deleted instance, a config row
 * claiming a reserved id, a half-filled instance.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTempDb } from "@tinkerbell/db/test-support";

setupTempDb("tinkerbell-arr-instances-test-");

const { db, config } = await import("@tinkerbell/db");
const { setConfig } = await import("./config.ts");
const { arrInstances, resolveArrInstance, DEFAULT_ARR_IDS } = await import("./arr-instances.ts");

function configureDefaults(): void {
  setConfig("global_radarr_url", "http://radarr:7878");
  setConfig("global_radarr_api_key", "key-radarr");
  setConfig("global_sonarr_url", "http://sonarr:8989");
  setConfig("global_sonarr_api_key", "key-sonarr");
}

beforeEach(() => {
  db.delete(config).run();
});

describe("arrInstances", () => {
  test("an install with only the original keys has exactly one instance per service", () => {
    configureDefaults();
    const radarr = arrInstances("radarr");
    assert.equal(radarr.length, 1);
    assert.equal(radarr[0].id, DEFAULT_ARR_IDS.radarr);
    assert.equal(radarr[0].isDefault, true);
    assert.equal(radarr[0].url, "http://radarr:7878");
  });

  test("an unconfigured service has no instances at all", () => {
    assert.deepEqual(arrInstances("radarr"), []);
  });

  test("extra instances come after the default", () => {
    configureDefaults();
    setConfig("global_arr_instances", [
      { id: "radarr-4k", service: "radarr", name: "4K", url: "http://radarr4k:7878", apiKey: "k" },
    ]);
    const radarr = arrInstances("radarr");
    assert.deepEqual(
      radarr.map((i) => i.id),
      [DEFAULT_ARR_IDS.radarr, "radarr-4k"],
    );
    assert.equal(radarr[1].isDefault, false);
  });

  test("instances of the other service are not returned", () => {
    configureDefaults();
    setConfig("global_arr_instances", [
      { id: "sonarr-anime", service: "sonarr", name: "Anime", url: "http://anime:8989", apiKey: "k" },
    ]);
    assert.deepEqual(
      arrInstances("radarr").map((i) => i.id),
      [DEFAULT_ARR_IDS.radarr],
    );
    assert.equal(arrInstances("sonarr").length, 2);
  });

  test("a half-filled instance is ignored rather than half-used", () => {
    configureDefaults();
    setConfig("global_arr_instances", [
      { id: "radarr-4k", service: "radarr", name: "4K", url: "http://radarr4k:7878", apiKey: "" },
    ]);
    assert.equal(arrInstances("radarr").length, 1);
  });

  test("an instance claiming a reserved default id cannot shadow the original", () => {
    // The original server is the one thing that must keep working untouched.
    configureDefaults();
    setConfig("global_arr_instances", [
      { id: "radarr", service: "radarr", name: "Impostor", url: "http://elsewhere:7878", apiKey: "k" },
    ]);
    const radarr = arrInstances("radarr");
    assert.equal(radarr.length, 1);
    assert.equal(radarr[0].url, "http://radarr:7878");
  });

  test("with no service given, both services are returned", () => {
    configureDefaults();
    assert.deepEqual(
      arrInstances().map((i) => i.service),
      ["radarr", "sonarr"],
    );
  });
});

describe("resolveArrInstance", () => {
  test("no id means the default — what every pre-existing rule carries", () => {
    configureDefaults();
    assert.equal(resolveArrInstance("radarr")?.url, "http://radarr:7878");
    assert.equal(resolveArrInstance("radarr", undefined)?.isDefault, true);
    assert.equal(resolveArrInstance("radarr", "")?.isDefault, true);
  });

  test("a named instance resolves to itself", () => {
    configureDefaults();
    setConfig("global_arr_instances", [
      { id: "radarr-4k", service: "radarr", name: "4K", url: "http://radarr4k:7878", apiKey: "k" },
    ]);
    assert.equal(resolveArrInstance("radarr", "radarr-4k")?.url, "http://radarr4k:7878");
  });

  test("an id that no longer exists falls back to the default rather than failing", () => {
    // Instances get deleted while rules still name them. Doing what the rule
    // did before that instance existed beats refusing to run.
    configureDefaults();
    assert.equal(resolveArrInstance("radarr", "radarr-deleted")?.isDefault, true);
  });

  test("nothing configured resolves to nothing", () => {
    assert.equal(resolveArrInstance("radarr", "radarr-4k"), null);
  });

  test("an extra instance stands in when no default is configured", () => {
    setConfig("global_arr_instances", [
      { id: "radarr-4k", service: "radarr", name: "4K", url: "http://radarr4k:7878", apiKey: "k" },
    ]);
    assert.equal(resolveArrInstance("radarr")?.id, "radarr-4k");
  });
});

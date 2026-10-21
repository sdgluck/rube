import { arrHealthServiceNames } from "@rube/domain.health";
/**
 * An extra \*Arr instance's health identity is its display name — `Radarr (4K)` —
 * because that string is what the notification target picker offers and what
 * somebody routing "tell me when the 4K one dies" is looking for.
 *
 * The price of a display-derived key is that renaming the instance changes it,
 * and everything filed under the old string is orphaned: its check history, its
 * mute, and every allow-list entry that named it. That is the sort of breakage
 * nobody connects to a rename weeks later, so the rename carries them over.
 */
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@rube/composition/test-support";
import { DbToken } from "@rube/db";
import { ConfigStoreToken } from "@rube/core";
import { healthChecks } from "@rube/db";
import { HealthToken } from "@rube/domain.health";

const c = createTestContainer();
after(() => c.dispose());

const db = c.resolve(DbToken);
const { getConfig, setConfig, deleteConfig } = c.resolve(ConfigStoreToken);
const { healthServices, renameArrHealthServices, reportHealth } = c.resolve(HealthToken);

const HD = { id: "radarr-hd", service: "radarr" as const, name: "HD", url: "http://hd:7878", apiKey: "k1" };
const UHD = { id: "radarr-4k", service: "radarr" as const, name: "4K", url: "http://uhd:7878", apiKey: "k2" };

beforeEach(() => {
  db.delete(healthChecks).run();
  deleteConfig("global_arr_instances");
  deleteConfig("health_mutes");
  deleteConfig("global_discord_health_targets");
});

describe("arrHealthServiceNames", () => {
  test("names each instance after its display name", () => {
    const names = arrHealthServiceNames([HD, UHD]);
    assert.deepEqual([...names.values()].sort(), ["Radarr (4K)", "Radarr (HD)"]);
  });

  test("two instances sharing a name do not collapse onto one row", () => {
    // Same name is a mistake, but a silent merge of two servers' health is a
    // worse one — the id keeps them apart.
    const twin = { ...UHD, id: "radarr-4k-2" };
    const names = arrHealthServiceNames([UHD, twin]);
    assert.equal(new Set(names.values()).size, 2);
    assert.deepEqual([...names.values()], ["Radarr (4K) #radarr-4k", "Radarr (4K) #radarr-4k-2"]);
  });

  test("the default instance is not one of these", () => {
    // "Radarr" plain is already in the static list.
    const names = arrHealthServiceNames([{ ...HD, isDefault: true }, UHD]);
    assert.deepEqual([...names.keys()], ["radarr-4k"]);
  });
});

describe("healthServices", () => {
  test("includes an entry per extra instance", () => {
    setConfig("global_arr_instances", [UHD]);
    assert.ok(
      healthServices()
        .map((s) => s.service)
        .includes("Radarr (4K)"),
    );
  });
});

describe("renameArrHealthServices", () => {
  test("carries history, the mute and the routing across a rename", () => {
    setConfig("global_arr_instances", [UHD]);
    reportHealth("Radarr (4K)", "error", "unreachable");
    setConfig("health_mutes", { "Radarr (4K)": 9_999_999_999_999 });
    setConfig("global_discord_health_targets", ["Plex", "Radarr (4K)"]);

    const before = [UHD];
    setConfig("global_arr_instances", [{ ...UHD, name: "UHD" }]);
    renameArrHealthServices(before);

    const services = db
      .select()
      .from(healthChecks)
      .all()
      .map((r) => r.service);
    assert.deepEqual(services, ["Radarr (UHD)"], "the check history moved with it");
    assert.deepEqual(getConfig("health_mutes"), { "Radarr (UHD)": 9_999_999_999_999 });
    assert.deepEqual(getConfig("global_discord_health_targets"), ["Plex", "Radarr (UHD)"]);
  });

  test("leaves everything alone when nothing was renamed", () => {
    setConfig("global_arr_instances", [UHD]);
    reportHealth("Radarr (4K)", "ok", "fine");
    setConfig("global_discord_health_targets", ["Radarr (4K)"]);

    renameArrHealthServices([UHD]);

    assert.deepEqual(getConfig("global_discord_health_targets"), ["Radarr (4K)"]);
    assert.equal(db.select().from(healthChecks).all()[0].service, "Radarr (4K)");
  });

  test("a removed instance takes nothing with it", () => {
    // Deleting an instance is not a rename: its history stays where it is rather
    // than being merged into whatever happens to be left.
    setConfig("global_arr_instances", [HD, UHD]);
    reportHealth("Radarr (4K)", "error", "unreachable");

    setConfig("global_arr_instances", [HD]);
    renameArrHealthServices([HD, UHD]);

    assert.equal(db.select().from(healthChecks).all()[0].service, "Radarr (4K)");
  });
});

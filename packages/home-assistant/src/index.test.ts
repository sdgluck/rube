/**
 * The publisher against the real tRPC graph and an in-memory broker.
 *
 * What would go wrong quietly, and so is pinned: discovery that HA can't
 * parse (entities never appear), a state topic republished every tick (HA's
 * history fills with identical rows), a prefix change that leaves the old
 * entities behind, and a switch-off that never says "offline". The snapshot
 * must also come back through a caller that cannot write.
 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createTestContainer } from "@tinkerbell/composition/test-support";
import { ServicesToken } from "@tinkerbell/composition";
import { DbToken, rules } from "@tinkerbell/db";
import { JobsToken, registerJobs } from "@tinkerbell/jobs";
import type { MqttConnection, MqttSettings } from "@tinkerbell/mqtt";
import { createTrpc } from "@tinkerbell/trpc";
import { createHomeAssistant, discoveryPayload, ENTITIES, topicsFor } from "./index.ts";

const c = createTestContainer({ overrides: registerJobs });
after(() => c.dispose());
const services = c.resolve(ServicesToken);
const { createCaller } = createTrpc({ ...services, jobs: c.resolve(JobsToken) });

interface Broker {
  connects: Array<{ settings: MqttSettings; clientId: string; will?: { topic: string; payload: string } }>;
  published: Array<{ topic: string; payload: string }>;
  ended: number;
  failConnect: boolean;
}

let broker: Broker;
let health: Array<[string, string, string]>;
let mqtt: { enabled: boolean; url: string; topicPrefix?: string } | undefined;

beforeEach(() => {
  broker = { connects: [], published: [], ended: 0, failConnect: false };
  health = [];
  mqtt = { enabled: true, url: "mqtt://broker.test:1883" };
  c.resolve(DbToken).delete(rules).run();
});

function publisher() {
  return createHomeAssistant({
    createCaller,
    scope: services.scope,
    getMqttConfig: () => mqtt,
    reportHealth: (...args) => health.push(args),
    version: "9.9.9",
    async connect(settings, opts) {
      if (broker.failConnect) throw new Error("Connection refused");
      broker.connects.push({ settings, ...opts });
      return {
        connected: true,
        async publish(topic, payload) {
          broker.published.push({ topic, payload });
        },
        async end() {
          broker.ended++;
        },
        onStatus() {},
      } satisfies MqttConnection;
    },
  });
}

const stateMessages = () => broker.published.filter((m) => m.topic === "tinkerbell/state");

test("discovery for every entity, then online, then the state", async () => {
  c.resolve(DbToken)
    .insert(rules)
    .values({ id: "r1", name: "Broken", type: "smart_filter", createdAt: 0, lastRunStatus: "error" })
    .run();
  const ha = publisher();
  await ha.tick();

  assert.equal(broker.connects.length, 1);
  assert.deepEqual(broker.connects[0].will, { topic: "tinkerbell/availability", payload: "offline" });
  const discovery = broker.published.filter((m) => m.topic.startsWith("homeassistant/"));
  assert.equal(discovery.length, ENTITIES.length);
  for (const m of discovery) assert.equal(JSON.parse(m.payload).state_topic, "tinkerbell/state");
  assert.ok(broker.published.some((m) => m.topic === "tinkerbell/availability" && m.payload === "online"));

  const [state] = stateMessages();
  const snapshot = JSON.parse(state.payload);
  assert.equal(snapshot.version, "9.9.9");
  assert.equal(snapshot.rules_failing, 1);
  assert.deepEqual(snapshot.attrs.failing_rules, ["Broken"]);
  // Plex isn't configured here, which must cost the streams figure and nothing else.
  assert.equal(snapshot.streams, 0);
  assert.deepEqual(health.at(-1)?.slice(0, 2), ["MQTT", "ok"]);
});

test("an unchanged snapshot isn't republished", async () => {
  const ha = publisher();
  await ha.tick();
  await ha.tick();
  assert.equal(stateMessages().length, 1);
  assert.equal(broker.connects.length, 1);
});

test("moving the topic prefix removes the old entities before reconnecting", async () => {
  const ha = publisher();
  await ha.tick();
  mqtt = { ...mqtt!, topicPrefix: "media" };
  await ha.tick();

  const retracted = broker.published.filter((m) => m.topic.includes("/tinkerbell/") && m.payload === "");
  assert.equal(retracted.length, ENTITIES.length);
  assert.ok(broker.published.some((m) => m.topic === "tinkerbell/availability" && m.payload === "offline"));
  assert.equal(broker.connects.length, 2);
  assert.equal(broker.connects[1].clientId, "tinkerbell-media");
  assert.ok(broker.published.some((m) => m.topic === "media/state"));
});

test("switching off says offline and disconnects", async () => {
  const ha = publisher();
  await ha.tick();
  mqtt = { ...mqtt!, enabled: false };
  await ha.tick();
  assert.equal(broker.published.at(-1)?.payload, "offline");
  assert.equal(broker.ended, 1);
});

test("a broker that refuses is a health error, not a throw, and is retried next tick", async () => {
  broker.failConnect = true;
  const ha = publisher();
  await ha.tick();
  assert.deepEqual(health.at(-1), ["MQTT", "error", "Connection refused"]);
  broker.failConnect = false;
  await ha.tick();
  assert.equal(broker.connects.length, 1);
});

test("a binary sensor reads ON/OFF and unique ids follow the prefix", () => {
  const topics = topicsFor({ topicPrefix: "media/tb" });
  const busy = ENTITIES.find((e) => e.id === "busy")!;
  const payload = discoveryPayload(topics, busy, "1.0.0");
  assert.equal(payload.value_template, "{{ 'ON' if value_json.busy else 'OFF' }}");
  assert.equal(payload.unique_id, "media_tb_busy");
  assert.equal(topics.state, "media/tb/state");
});

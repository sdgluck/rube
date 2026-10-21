/**
 * Home Assistant over MQTT: publish Rube's state, with discovery.
 *
 * **State only, by construction.** The client never subscribes, and the
 * snapshot is read through a caller carrying an `apiKey` identity, so
 * `refuseWritesFromAgents` refuses any mutation even if a later edit tried
 * one. Anyone who can publish to the broker can therefore read nothing more
 * than they could already, and change nothing.
 *
 * Driven by `tick()` on an interval from the server, like the portal
 * reconciler: settings change in the UI, and polling the config is simpler
 * than threading a change signal from `setConfig` to here. A tick connects,
 * reconnects after a settings change, or disconnects when switched off, then
 * publishes the snapshot if it changed. Retained messages mean HA restarting
 * gets the current state without waiting for a change.
 *
 * Main process only: the Sidequest worker builds its own container, and two
 * publishers would fight over the availability topic.
 */

import type { Scope } from "@rube/container";
import { createLogger, errorMessage } from "@rube/core";
import { connectMqtt, type MqttConnection } from "@rube/mqtt";
import type { AdminContext, createTrpc } from "@rube/trpc";
import { discoveryPayload, discoveryTopic, ENTITIES, topicsFor, type Topics } from "./entities.ts";
import { takeSnapshot } from "./snapshot.ts";

export { ENTITIES, topicsFor, discoveryPayload, discoveryTopic } from "./entities.ts";
export type { Snapshot } from "./entities.ts";

const log = createLogger("home-assistant");

export const HOME_ASSISTANT_TICK_MS = 30_000;
/** Republish an unchanged snapshot this often, so a broker that lost its retained store recovers. */
const REFRESH_MS = 10 * 60_000;

interface MqttConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
  topicPrefix?: string;
  discoveryPrefix?: string;
}

export interface HomeAssistantDeps {
  createCaller: ReturnType<typeof createTrpc>["createCaller"];
  scope: Scope;
  getMqttConfig: () => MqttConfig | undefined;
  reportHealth: (service: string, status: "ok" | "error", message: string) => void;
  version: string;
  /** Replaced in tests with an in-memory broker. */
  connect?: typeof connectMqtt;
  now?: () => number;
}

export function createHomeAssistant(deps: HomeAssistantDeps) {
  const { createCaller, scope: rootScope, getMqttConfig, reportHealth, version } = deps;
  const connect = deps.connect ?? connectMqtt;
  const now = deps.now ?? Date.now;

  let conn: MqttConnection | null = null;
  let connectedAs: string | null = null;
  let topics: Topics | null = null;
  let lastPayload = "";
  let lastPublishedAt = 0;
  let ticking = false;

  async function disconnect(): Promise<void> {
    if (!conn) return;
    const c = conn;
    conn = null;
    connectedAs = null;
    try {
      await c.publish(topics!.availability, "offline");
    } catch {
      // Going away anyway; the broker's will message says the same thing.
    }
    await c.end();
  }

  /**
   * Empty retained payloads on the old discovery topics, which is how HA is
   * told an entity is gone. Without it, moving the topic prefix leaves a
   * second, permanently unavailable copy of every entity behind.
   */
  async function retract(c: MqttConnection, old: Topics): Promise<void> {
    for (const entity of ENTITIES) await c.publish(discoveryTopic(old, entity), "");
  }

  async function snapshotJson(): Promise<string> {
    const scope = rootScope.createScope("home-assistant");
    try {
      const ctx: AdminContext = {
        scope,
        apiKey: { id: "home-assistant", name: "Home Assistant" },
        resHeaders: new Headers(),
        secure: false,
        origin: "",
        ip: "home-assistant",
        authRequired: true,
      };
      return JSON.stringify(await takeSnapshot(createCaller(ctx), version));
    } finally {
      await scope.dispose();
    }
  }

  async function tickOnce(): Promise<void> {
    const cfg = getMqttConfig();
    if (!cfg?.enabled || !cfg.url) {
      if (conn) log.info("switched off — disconnecting");
      await disconnect();
      return;
    }

    const identity = JSON.stringify([cfg.url, cfg.username, cfg.password, cfg.topicPrefix, cfg.discoveryPrefix]);
    if (conn && connectedAs !== identity) {
      log.info("settings changed — reconnecting");
      const old = topics!;
      const next = topicsFor(cfg);
      if (old.discoveryPrefix !== next.discoveryPrefix || old.node !== next.node) {
        await retract(conn, old).catch((err) => log.warn("couldn't remove old entities", { err: errorMessage(err) }));
      }
      await disconnect();
    }

    if (!conn) {
      const t = topicsFor(cfg);
      try {
        conn = await connect(cfg, {
          clientId: `rube-${t.node}`,
          will: { topic: t.availability, payload: "offline" },
        });
      } catch (err) {
        reportHealth("MQTT", "error", errorMessage(err));
        return;
      }
      topics = t;
      connectedAs = identity;
      lastPayload = "";
      conn.onStatus((status, error) => {
        if (status === "disconnected") reportHealth("MQTT", "error", error ?? "Lost the broker; reconnecting");
        else {
          reportHealth("MQTT", "ok", `Connected to ${new URL(cfg.url).host}`);
          // A broker restart without persistence drops retained messages.
          lastPayload = "";
        }
      });
      for (const entity of ENTITIES) {
        await conn.publish(discoveryTopic(t, entity), JSON.stringify(discoveryPayload(t, entity, version)));
      }
      await conn.publish(t.availability, "online");
      reportHealth("MQTT", "ok", `Connected to ${new URL(cfg.url).host}`);
      log.info("connected", { broker: new URL(cfg.url).host, entities: ENTITIES.length });
    }

    if (!conn.connected) return;
    const payload = await snapshotJson();
    if (payload === lastPayload && now() - lastPublishedAt < REFRESH_MS) return;
    await conn.publish(topics!.state, payload);
    lastPayload = payload;
    lastPublishedAt = now();
  }

  /** Never throws and never overlaps: a slow broker skips a tick rather than stacking them. */
  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      await tickOnce();
    } catch (err) {
      reportHealth("MQTT", "error", errorMessage(err));
      log.warn("publish failed", { err: errorMessage(err) });
    } finally {
      ticking = false;
    }
  }

  async function stop(): Promise<void> {
    await disconnect().catch(() => {});
  }

  return { tick, stop };
}

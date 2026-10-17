/**
 * The MQTT broker, as Tinkerbell uses it: connect, publish retained JSON, leave.
 *
 * Not an HTTP API, so `@tinkerbell/http` and the `fetch` deadline guard don't
 * reach it — the deadlines live here instead. Every wait has one: a broker that
 * accepts the TCP connection and never sends CONNACK would otherwise hang the
 * Settings "Test" button and the health job, which runs every other check in
 * sequence behind it.
 *
 * Nothing subscribes. The Home Assistant integration is state-only by design,
 * and a client that never subscribes cannot be told to do anything.
 */

import mqtt, { type IClientOptions, type MqttClient } from "mqtt";

/** Inlined rather than imported from core: core's dev graph reaches back here through health, a cycle pnpm warns about on every install. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface MqttSettings {
  /** `mqtt://`, `mqtts://`, `ws://` or `wss://`, with the port if it isn't the default. */
  url: string;
  username?: string;
  password?: string;
}

export interface MqttWill {
  topic: string;
  payload: string;
}

export interface MqttConnection {
  /** Retained by default: Home Assistant reads discovery and state on its own restart. */
  publish(topic: string, payload: string, opts?: { retain?: boolean }): Promise<void>;
  end(): Promise<void>;
  readonly connected: boolean;
  /** Fires on every transition, including the library's own reconnects. */
  onStatus(listener: (status: "connected" | "disconnected", error?: string) => void): void;
}

const CONNECT_TIMEOUT_MS = 10_000;
const PUBLISH_TIMEOUT_MS = 10_000;
/** Between reconnect attempts after a broker restart. The library default (1s) is a busy loop against a dead host. */
const RECONNECT_MS = 15_000;

const SCHEMES = new Set(["mqtt:", "mqtts:", "ws:", "wss:"]);

/** Throws a sentence the Settings page can show as-is. */
export function validateMqttUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Not a URL — expected something like mqtt://192.168.1.10:1883");
  }
  if (!SCHEMES.has(parsed.protocol)) {
    throw new Error(`Unsupported scheme ${parsed.protocol} — use mqtt://, mqtts://, ws:// or wss://`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function optionsFor(settings: MqttSettings, clientId: string, extra: IClientOptions): IClientOptions {
  return {
    clientId,
    username: settings.username || undefined,
    password: settings.password || undefined,
    connectTimeout: CONNECT_TIMEOUT_MS,
    ...extra,
  };
}

/**
 * A long-lived connection that reconnects by itself. Resolves once the broker
 * has accepted the first CONNECT; rejects (and gives up) if it never does.
 */
export async function connectMqtt(
  settings: MqttSettings,
  opts: { clientId: string; will?: MqttWill },
): Promise<MqttConnection> {
  validateMqttUrl(settings.url);
  const client: MqttClient = mqtt.connect(
    settings.url,
    optionsFor(settings, opts.clientId, {
      reconnectPeriod: RECONNECT_MS,
      will: opts.will
        ? { topic: opts.will.topic, payload: Buffer.from(opts.will.payload), retain: true, qos: 1 }
        : undefined,
    }),
  );

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        client.once("connect", () => resolve());
        client.once("error", (err) => reject(err));
      }),
      CONNECT_TIMEOUT_MS,
      "Connecting to the broker",
    );
  } catch (err) {
    client.end(true);
    throw err;
  }

  return {
    publish: (topic, payload, { retain = true } = {}) =>
      withTimeout(
        client.publishAsync(topic, payload, { retain, qos: 1 }).then(() => undefined),
        PUBLISH_TIMEOUT_MS,
        "Publishing",
      ),
    end: () =>
      withTimeout(client.endAsync(), PUBLISH_TIMEOUT_MS, "Disconnecting").catch(() =>
        client.end(true),
      ) as Promise<void>,
    get connected() {
      return client.connected;
    },
    onStatus(listener) {
      client.on("connect", () => listener("connected"));
      client.on("offline", () => listener("disconnected"));
      client.on("error", (err) => listener("disconnected", errorMessage(err)));
    },
  };
}

/** Connect once and leave — the Settings test and the health check. */
export async function testMqtt(settings: MqttSettings): Promise<string> {
  validateMqttUrl(settings.url);
  const client = await withTimeout(
    mqtt.connectAsync(settings.url, optionsFor(settings, `tinkerbell-test-${Date.now()}`, { reconnectPeriod: 0 })),
    CONNECT_TIMEOUT_MS + 1_000,
    "Connecting to the broker",
  );
  await client.endAsync().catch(() => client.end(true));
  return `Connected to ${new URL(settings.url).host}`;
}

/**
 * Minimal structured logger.
 *
 * Everything used to be `console.log` with a hand-typed `[scope]` prefix: no
 * levels, no way to turn detail up when debugging a home-server install, and
 * no run-ID correlation. This gives us all three without pulling in a logging
 * framework.
 *
 * Output is plain text by default:
 *
 *     2026-08-04T09:15:00.123Z INFO  [jobs] Sidequest engine started queues=2
 *
 * Set `LOG_FORMAT=json` for one JSON object per line, for anyone shipping
 * container logs to a collector.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function parseLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  // `trace`/`verbose` are common aliases people reach for; treat them as debug
  // rather than silently falling back to info.
  if (value === "trace" || value === "verbose") return "debug";
  return "info";
}

// Parsed once at import. Changing LOG_LEVEL requires a restart, which is the
// same contract as every other env var in this app.
const currentLevel = parseLevel(process.env.LOG_LEVEL);
const asJson = (process.env.LOG_FORMAT ?? "").trim().toLowerCase() === "json";

/** The effective level, for callers that need to mirror it (e.g. Sidequest's own logger). */
export function logLevel(): LogLevel {
  return currentLevel;
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that stamps `fields` onto every line (e.g. `{ runId, command }`). */
  child(fields: LogFields): Logger;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    // Quote only when the value would otherwise break `key=value` parsing.
    return /[\s"=]/.test(value) ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return JSON.stringify(value.message);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function emit(level: LogLevel, scope: string, message: string, fields: LogFields): void {
  if (!isLevelEnabled(level)) return;
  const timestamp = new Date().toISOString();
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (asJson) {
    sink(JSON.stringify({ ts: timestamp, level, scope, msg: message, ...fields }));
    return;
  }

  const pairs = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${formatValue(v)}`);
  const suffix = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
  sink(`${timestamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}`);
}

export function createLogger(scope: string, baseFields: LogFields = {}): Logger {
  const log = (level: LogLevel) => (message: string, fields?: LogFields) =>
    emit(level, scope, message, fields ? { ...baseFields, ...fields } : baseFields);

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (fields: LogFields) => createLogger(scope, { ...baseFields, ...fields }),
  };
}

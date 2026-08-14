export function describeCron(expr: string): string {
  if (!expr) return "";
  const parts = expr.trim().split(/\s+/);
  // Croner accepts a leading seconds field. Only the playback poller uses one,
  // but it would otherwise render as a raw expression in the Jobs UI.
  if (parts.length === 6) {
    const [sec, ...rest] = parts;
    if (sec.startsWith("*/") && rest.every((p) => p === "*")) return `Every ${sec.slice(2)} seconds`;
    if (sec === "*" && rest.every((p) => p === "*")) return "Every second";
    return describeCron(rest.join(" "));
  }
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every minute";
  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (dom === "*" && mon === "*" && dow === "*") {
    if (hour === "*" && min === "0") return "Every hour";
    if (hour.startsWith("*/") && min === "0") return `Every ${hour.slice(2)} hours`;
    if (hour !== "*" && !hour.includes("/")) return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return expr;
}

export function stripDurationFromMessage(message: string): string {
  return message.replace(/\s+in\s+(?:\d+m\s+)?\d+s\b/, "");
}

/**
 * Pull a human-readable reason out of whatever a mutation rejected with.
 * Toasts that swallow this and print a fixed "Failed to X" make a server
 * saying "no, and here's why" indistinguishable from a dead button.
 */
export function errorMessage(err: unknown, fallback = "Unknown error"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

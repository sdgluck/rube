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
  // Weekly. The poster cache refresh runs Sundays at 03:00 and was the one
  // schedule in System Tasks shown as a raw `0 3 * * 0`.
  if (dom === "*" && mon === "*" && /^\d+$/.test(hour) && /^\d+$/.test(min)) {
    const days = weekdays(dow);
    if (days) return `${days} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return expr;
}

const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** A day-of-week field as words, or undefined when it isn't one we can say plainly. */
function weekdays(dow: string): string | undefined {
  if (dow === "1-5") return "Weekdays";
  if (dow === "0,6" || dow === "6,0" || dow === "6,7") return "Weekends";
  const days = dow.split(",");
  if (!days.every((d) => /^[0-7]$/.test(d))) return undefined;
  const names = days.map((d) => DAY_NAMES[Number(d) % 7]!);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
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

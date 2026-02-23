export function describeCron(expr: string): string {
  if (!expr) return "";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (dom === "*" && mon === "*" && dow === "*") {
    if (hour === "*" && min === "0") return "Every hour";
    if (hour.startsWith("*/") && min === "0") return `Every ${hour.slice(2)} hours`;
    if (hour !== "*" && !hour.includes("/")) return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return expr;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

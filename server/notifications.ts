import { getConfig } from "./config.ts";

export const EVENT_TYPES = [
  { id: "job.completed", label: "Job Completed" },
  { id: "job.failed", label: "Job Failed" },
  { id: "health.failed", label: "Health Check Failed" },
  { id: "health.recovered", label: "Health Check Recovered" },
] as const;

export async function sendPushover(title: string, message: string): Promise<void> {
  const apiKey = getConfig("global_pushover_api_key");
  const userKey = getConfig("global_pushover_user_key");
  if (!apiKey || !userKey) return;

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: apiKey,
      user: userKey,
      title,
      message,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[pushover] Failed to send notification: ${res.status} ${body}`);
  }
}

export function notifyEvent(type: string, message: string): void {
  const enabledEvents = getConfig("global_pushover_events");
  if (!enabledEvents || !enabledEvents.includes(type)) return;

  const label = EVENT_TYPES.find((e) => e.id === type)?.label ?? type;
  sendPushover(label, message).catch((err) => {
    console.error(`[pushover] Error sending notification:`, err);
  });
}

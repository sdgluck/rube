/**
 * One function per destination.
 *
 * Each takes the same `RichMessage` and renders as much of it as its service
 * understands. Discord and Slack get real structure; Gotify, Pushover,
 * Pushbullet and LunaSea get `flattenMessage`, which is why `text` has to
 * stand on its own. Nothing here may throw on a message that carries only
 * `title` and `text` — that is the shape every existing event notification
 * has, and the rich fields are additions to it.
 */
import { getConfig } from "@tinkerbell/core";
import { assertSafeOutboundUrl } from "@tinkerbell/http";
import { flattenMessage, type RichMessage } from "./types.ts";

const TIMEOUT_MS = 10_000;

/** Discord's blurple, used for every embed since the first one. */
const EMBED_COLOR = 0x237feb;

/** Discord caps an embed at 25 fields and 1024 characters per field value. */
const DISCORD_MAX_FIELDS = 25;
const DISCORD_MAX_FIELD_CHARS = 1024;

/** Telegram rejects a caption over 1024 chars; a plain message allows 4096. */
const TELEGRAM_MAX_CAPTION = 1024;
const TELEGRAM_MAX_TEXT = 4096;

async function postJson(service: string, url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${service}: ${res.status} ${text}`);
  }
}

/** Clip to a service's field limit without cutting mid-line where avoidable. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastBreak = cut.lastIndexOf("\n");
  return `${lastBreak > max / 2 ? cut.slice(0, lastBreak) : cut}…`;
}

export async function sendPushover(message: RichMessage): Promise<void> {
  const apiKey = getConfig("global_pushover_api_key");
  const userKey = getConfig("global_pushover_user_key");
  if (!apiKey || !userKey) throw new Error("Pushover API key and user key are required");

  await postJson("Pushover", "https://api.pushover.net/1/messages.json", {
    token: apiKey,
    user: userKey,
    title: message.title,
    message: flattenMessage(message),
  });
}

/**
 * Discord is where a digest actually looks good: one embed, one field per
 * block, and the poster as a thumbnail when there is one.
 */
export async function sendDiscord(message: RichMessage): Promise<void> {
  const webhookUrl = getConfig("global_discord_webhook_url");
  if (!webhookUrl) throw new Error("Discord webhook URL is required");
  assertSafeOutboundUrl(webhookUrl);

  const fields = (message.blocks ?? [])
    .filter((block) => block.lines.length > 0)
    .slice(0, DISCORD_MAX_FIELDS)
    .map((block) => ({
      name: block.heading,
      value: clip(block.lines.map((line) => `• ${line}`).join("\n"), DISCORD_MAX_FIELD_CHARS),
    }));

  await postJson("Discord", webhookUrl, {
    embeds: [
      {
        title: message.title,
        description: message.text,
        color: EMBED_COLOR,
        ...(fields.length > 0 ? { fields } : {}),
        ...(message.imageUrl ? { thumbnail: { url: message.imageUrl } } : {}),
      },
    ],
  });
}

export async function sendGotify(message: RichMessage): Promise<void> {
  const url = getConfig("global_gotify_url");
  const token = getConfig("global_gotify_token");
  if (!url || !token) throw new Error("Gotify URL and application token are required");

  const endpoint = new URL("/message", url);
  assertSafeOutboundUrl(endpoint);
  await postJson(
    "Gotify",
    endpoint.toString(),
    { title: message.title, message: flattenMessage(message), priority: 5 },
    { "X-Gotify-Key": token },
  );
}

export async function sendLunaSea(message: RichMessage): Promise<void> {
  const webhookUrl = getConfig("global_lunasea_webhook_url");
  if (!webhookUrl) throw new Error("LunaSea webhook URL is required");
  assertSafeOutboundUrl(webhookUrl);

  await postJson("LunaSea", webhookUrl, { title: message.title, body: flattenMessage(message) });
}

export async function sendPushbullet(message: RichMessage): Promise<void> {
  const token = getConfig("global_pushbullet_token");
  if (!token) throw new Error("Pushbullet access token is required");

  await postJson(
    "Pushbullet",
    "https://api.pushbullet.com/v2/pushes",
    { type: "note", title: message.title, body: flattenMessage(message) },
    { "Access-Token": token },
  );
}

/** Slack Block Kit, with `text` kept as the notification-preview fallback. */
export async function sendSlack(message: RichMessage): Promise<void> {
  const webhookUrl = getConfig("global_slack_webhook_url");
  if (!webhookUrl) throw new Error("Slack webhook URL is required");
  assertSafeOutboundUrl(webhookUrl);

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: clip(message.title, 150), emoji: true } },
  ];
  if (message.text) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(message.text, 3000) } });
  }
  for (const block of message.blocks ?? []) {
    if (block.lines.length === 0) continue;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: clip(`*${block.heading}*\n${block.lines.map((line) => `• ${line}`).join("\n")}`, 3000),
      },
    });
  }

  await postJson("Slack", webhookUrl, {
    // `text` is what Slack shows in the notification popup and in clients that
    // can't render blocks, so it is sent even when blocks are present.
    text: `*${message.title}*\n${message.text}`,
    blocks,
  });
}

/**
 * Telegram: a photo with an HTML caption when there's an image, a plain HTML
 * message otherwise. The two endpoints have different length limits, which is
 * why the body is clipped differently in each branch.
 */
export async function sendTelegram(message: RichMessage): Promise<void> {
  const botToken = getConfig("global_telegram_bot_token");
  const chatId = getConfig("global_telegram_chat_id");
  if (!botToken || !chatId) throw new Error("Telegram bot token and chat ID are required");

  const sendSilently = getConfig("global_telegram_send_silently") ?? false;
  const body = `<b>${escapeHtml(message.title)}</b>\n${escapeHtml(flattenMessage(message))}`;

  if (message.imageUrl) {
    await postJson("Telegram", `https://api.telegram.org/bot${botToken}/sendPhoto`, {
      chat_id: chatId,
      photo: message.imageUrl,
      caption: clip(body, TELEGRAM_MAX_CAPTION),
      parse_mode: "HTML",
      disable_notification: sendSilently,
    });
    return;
  }

  await postJson("Telegram", `https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text: clip(body, TELEGRAM_MAX_TEXT),
    parse_mode: "HTML",
    disable_notification: sendSilently,
  });
}

/**
 * The generic webhook gets the whole structured payload, which is what a
 * webhook consumer wanted in the first place. `title`/`message` keep their
 * original meaning so an existing receiver carries on working unchanged.
 */
export async function sendWebhook(message: RichMessage): Promise<void> {
  const url = getConfig("global_webhook_url");
  if (!url) throw new Error("Webhook URL is required");
  // Webhook URLs are typed in by the admin and the destination is arbitrary,
  // so this is the most attractive SSRF target in the codebase. The host
  // check defaults off in dev and can be opted out of in production.
  assertSafeOutboundUrl(url);

  await postJson("Webhook", url, {
    title: message.title,
    message: message.text,
    timestamp: Date.now(),
    ...(message.blocks ? { blocks: message.blocks } : {}),
    ...(message.data ? { data: message.data } : {}),
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * What each service does with a message it can only partly render.
 *
 * The load-bearing property is that **no sender may crash on a message that
 * carries only `title` and `text`** — that is the shape every event
 * notification has had since before blocks existed — and no sender may drop
 * the content of `blocks` when it can't render them structurally. A service
 * that silently sent the headline and swallowed the list would look like it
 * was working.
 */
import { describe, test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";

import { createTestContainer } from "@rube/composition/test-support";
import { ConfigStoreToken } from "@rube/core";
import {
  flattenMessage,
  NotificationsToken,
  plainMessage,
  renderEmailHtml,
  SmtpNotConfiguredError,
} from "@rube/domain.notifications";

const c = createTestContainer();
after(() => c.dispose());

const { setConfig, deleteConfig } = c.resolve(ConfigStoreToken);
const { sendDiscord, sendSlack, sendTelegram, sendWebhook, sendGotify, sendPushover, sendPushbullet, sendLunaSea } =
  c.resolve(NotificationsToken);
const { smtpConfigured, sendSmtp } = c.resolve(NotificationsToken);

const RICH = {
  title: "Your library, 8 Nov – 14 Nov",
  text: "Here's what happened.\n3 items added · 5 hours watched",
  blocks: [
    { heading: "Added", lines: ["A Film (2021)", "Another Film (1999)"] },
    { heading: "Leaving soon", lines: ["Doomed (1984) — goes on the next run"] },
    // An empty block is normal — `renderDigest` filters, but a hand-built
    // message needn't, and a sender must not emit an empty section for it.
    { heading: "Nothing here", lines: [] },
  ],
};

const PLAIN = plainMessage("Job Completed", "Generate Collections completed in 3m 7s");

/** Captured outbound requests, so nothing here touches the network. */
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("", { status: 200 });
  }) as typeof fetch;

  setConfig("global_discord_webhook_url", "https://discord.com/api/webhooks/1/abc");
  setConfig("global_slack_webhook_url", "https://hooks.slack.com/services/T/B/x");
  setConfig("global_telegram_bot_token", "bot-token");
  setConfig("global_telegram_chat_id", "12345");
  setConfig("global_webhook_url", "https://example.com/hook");
  setConfig("global_gotify_url", "https://gotify.example.com");
  setConfig("global_gotify_token", "gotify-token");
  setConfig("global_pushover_api_key", "app");
  setConfig("global_pushover_user_key", "user");
  setConfig("global_pushbullet_token", "pb");
  setConfig("global_lunasea_webhook_url", "https://notify.lunasea.app/v1/custom/x");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("flattenMessage", () => {
  test("keeps every line of every block", () => {
    const flat = flattenMessage(RICH);
    assert.match(flat, /A Film \(2021\)/);
    assert.match(flat, /Another Film \(1999\)/);
    assert.match(flat, /Doomed \(1984\)/);
  });

  test("omits a block with no lines", () => {
    assert.doesNotMatch(flattenMessage(RICH), /Nothing here/);
  });

  test("a message with no blocks is just its text", () => {
    assert.equal(flattenMessage(PLAIN), PLAIN.text);
  });
});

describe("plain-text services", () => {
  const plainSenders = [
    ["gotify", sendGotify, (b: Record<string, unknown>) => b.message],
    ["pushover", sendPushover, (b: Record<string, unknown>) => b.message],
    ["pushbullet", sendPushbullet, (b: Record<string, unknown>) => b.body],
    ["lunasea", sendLunaSea, (b: Record<string, unknown>) => b.body],
  ] as const;

  for (const [name, send, body] of plainSenders) {
    test(`${name} falls back to flattened text and doesn't choke on blocks`, async () => {
      await send(RICH);
      assert.match(String(body(calls[0].body)), /A Film \(2021\)/);
    });

    test(`${name} still sends a message with no blocks at all`, async () => {
      await send(PLAIN);
      assert.equal(String(body(calls[0].body)), PLAIN.text);
    });
  }
});

describe("discord", () => {
  test("renders blocks as embed fields", async () => {
    await sendDiscord(RICH);
    const embed = (calls[0].body.embeds as Array<Record<string, unknown>>)[0];
    const fields = embed.fields as Array<{ name: string; value: string }>;
    assert.equal(fields.length, 2, "the empty block should be dropped");
    assert.equal(fields[0].name, "Added");
    assert.match(fields[0].value, /A Film \(2021\)/);
  });

  test("a plain message produces an embed with no fields, not an empty array", async () => {
    await sendDiscord(PLAIN);
    const embed = (calls[0].body.embeds as Array<Record<string, unknown>>)[0];
    assert.equal(embed.fields, undefined);
    assert.equal(embed.description, PLAIN.text);
  });

  test("no image means no thumbnail key", async () => {
    await sendDiscord(RICH);
    const embed = (calls[0].body.embeds as Array<Record<string, unknown>>)[0];
    assert.equal(embed.thumbnail, undefined, "a broken thumbnail is worse than none");
  });
});

describe("slack", () => {
  test("renders Block Kit while keeping `text` as the notification preview", async () => {
    await sendSlack(RICH);
    const body = calls[0].body;
    assert.ok(String(body.text).includes(RICH.title), "clients that can't render blocks show `text`");
    const blocks = body.blocks as Array<{ type: string }>;
    assert.equal(blocks[0].type, "header");
    assert.equal(blocks.length, 4, "header + text + two non-empty blocks");
  });

  test("a plain message is still valid Block Kit", async () => {
    await sendSlack(PLAIN);
    const blocks = calls[0].body.blocks as Array<{ type: string }>;
    assert.equal(blocks.length, 2);
  });
});

describe("telegram", () => {
  test("sends a plain message when there's no image", async () => {
    await sendTelegram(RICH);
    assert.match(calls[0].url, /sendMessage$/);
  });

  test("sends a photo when there is one", async () => {
    await sendTelegram({ ...RICH, imageUrl: "https://example.com/p.jpg" });
    assert.match(calls[0].url, /sendPhoto$/);
    assert.equal(calls[0].body.photo, "https://example.com/p.jpg");
  });

  test("escapes HTML so a title with an angle bracket can't break the markup", async () => {
    await sendTelegram(plainMessage("A <b>bold</b> title", "body & more"));
    const text = String(calls[0].body.text);
    assert.match(text, /&lt;b&gt;bold&lt;\/b&gt;/);
    assert.match(text, /body &amp; more/);
  });
});

describe("webhook", () => {
  test("carries the structured payload as well as the strings", async () => {
    await sendWebhook({ ...RICH, data: { stats: { itemsAdded: 3 } } });
    const body = calls[0].body;
    assert.equal(body.title, RICH.title);
    assert.equal(body.message, RICH.text);
    assert.ok(Array.isArray(body.blocks));
    assert.deepEqual(body.data, { stats: { itemsAdded: 3 } });
  });

  test("an event notification keeps the original flat shape", async () => {
    await sendWebhook(PLAIN);
    const body = calls[0].body;
    assert.equal(body.title, PLAIN.title);
    assert.equal(body.message, PLAIN.text);
    assert.equal(body.blocks, undefined, "an existing consumer must see no new required fields");
  });
});

describe("email", () => {
  beforeEach(() => deleteConfig("global_smtp"));

  test("absent SMTP config reports unconfigured rather than throwing", () => {
    assert.equal(smtpConfigured(), false);
  });

  test("sending with no SMTP config fails as a distinct, recognisable type", async () => {
    // The digest job branches on this to record a skip rather than a failure —
    // an install with no mail server hasn't failed to send anything.
    await assert.rejects(() => sendSmtp(RICH, { to: "someone@example.com" }), SmtpNotConfiguredError);
  });

  test("a configured host with no recipient anywhere is also a clean skip", async () => {
    setConfig("global_smtp", { host: "smtp.example.com", port: 587, secure: false, from: "tb@example.com" });
    assert.equal(smtpConfigured(), true);
    await assert.rejects(() => sendSmtp(RICH), SmtpNotConfiguredError);
  });

  test("the HTML escapes its content", () => {
    const html = renderEmailHtml(plainMessage("A <script>alert(1)</script> title", "body & more"));
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /body &amp; more/);
  });

  test("the HTML uses inline styles and tables, which is what renders anywhere", () => {
    const html = renderEmailHtml(RICH);
    assert.match(html, /<table/);
    assert.match(html, /style="/);
    assert.doesNotMatch(html, /<style/, "a <style> block is stripped by several webmail clients");
  });

  test("every block's lines survive into the HTML", () => {
    const html = renderEmailHtml(RICH);
    assert.match(html, /A Film \(2021\)/);
    assert.match(html, /Doomed \(1984\)/);
    assert.doesNotMatch(html, /Nothing here/);
  });
});

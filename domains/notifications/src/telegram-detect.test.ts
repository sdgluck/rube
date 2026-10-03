/**
 * Against a real HTTP server on port 0 rather than a `fetch` stub: what is
 * worth checking is the path the token is put into and how Telegram's error
 * statuses come back, and a stub would agree with whatever the code assumed.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

import { detectTelegramChats, TelegramDetectError } from "./telegram-detect.ts";

const requests: string[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, result: [] } };
let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("detectTelegramChats", () => {
  test("asks getUpdates for the bot, and lists each chat once, newest first", async () => {
    reply = {
      status: 200,
      body: {
        ok: true,
        result: [
          { update_id: 1, message: { chat: { id: 42, type: "private", first_name: "Sam", last_name: "G" } } },
          { update_id: 2, channel_post: { chat: { id: -1001, type: "channel", title: "Alerts" } } },
          { update_id: 3, message: { chat: { id: 42, type: "private", first_name: "Sam", last_name: "G" } } },
          { update_id: 4, my_chat_member: { chat: { id: -5, type: "group", title: "Family" } } },
        ],
      },
    };
    const chats = await detectTelegramChats("123:abc", { baseUrl });
    assert.equal(requests.at(-1), "/bot123%3Aabc/getUpdates");
    assert.deepEqual(chats, [
      { id: "-5", title: "Family", type: "group" },
      { id: "42", title: "Sam G", type: "private" },
      { id: "-1001", title: "Alerts", type: "channel" },
    ]);
  });

  test("no messages yet is an empty list, not an error", async () => {
    reply = { status: 200, body: { ok: true, result: [] } };
    assert.deepEqual(await detectTelegramChats("t", { baseUrl }), []);
  });

  test("a bad token is named as such, without echoing the URL it was in", async () => {
    reply = { status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } };
    await assert.rejects(detectTelegramChats("secret-token", { baseUrl }), (err: unknown) => {
      assert.ok(err instanceof TelegramDetectError);
      assert.match(err.message, /bot token/);
      assert.doesNotMatch(err.message, /secret-token/);
      return true;
    });
  });

  test("a webhook blocks getUpdates, and says so", async () => {
    reply = { status: 409, body: { ok: false, error_code: 409, description: "Conflict" } };
    await assert.rejects(detectTelegramChats("t", { baseUrl }), /webhook/);
  });
});

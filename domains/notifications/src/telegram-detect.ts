/**
 * Find the chat a Telegram bot has been messaged from.
 *
 * Telegram has no "what is my chat id" screen. The documented route is to
 * message the bot and then read `chat.id` out of the raw `getUpdates` JSON in
 * a browser — with the bot token pasted into the address bar. This is that
 * lookup, done server-side so the token never leaves it.
 *
 * Read-only by construction: `getUpdates` without an `offset` doesn't
 * acknowledge anything, so whatever else reads this bot's updates still sees
 * them afterwards.
 */
import { httpRequestJson, HttpError } from "@rube/http";

export interface TelegramChat {
  id: string;
  /** A group's title, or a person's name / @username. */
  title: string;
  type: string;
}

interface RawChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/** `message`, `channel_post`, `my_chat_member`… — whichever kind, each carries a `chat`. */
type RawUpdate = Record<string, unknown>;

export class TelegramDetectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramDetectError";
  }
}

function chatTitle(chat: RawChat): string {
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
  if (name) return name;
  return chat.username ? `@${chat.username}` : String(chat.id);
}

/**
 * Every chat the bot has pending updates from, most recent first.
 *
 * Empty is a real answer — nobody has messaged the bot since its updates were
 * last consumed — and the caller says so rather than treating it as a failure.
 */
export async function detectTelegramChats(token: string, opts: { baseUrl?: string } = {}): Promise<TelegramChat[]> {
  const base = opts.baseUrl ?? "https://api.telegram.org";
  let body: { ok: boolean; result?: RawUpdate[]; description?: string };
  try {
    body = await httpRequestJson({ url: `${base}/bot${encodeURIComponent(token)}/getUpdates`, timeoutMs: 10_000 });
  } catch (err) {
    // Rephrased rather than passed on: the request URL carries the token, and
    // the two failures people actually hit have a fix worth naming.
    if (err instanceof HttpError && (err.status === 401 || err.status === 404)) {
      throw new TelegramDetectError("Telegram didn't recognise that bot token.");
    }
    if (err instanceof HttpError && err.status === 409) {
      throw new TelegramDetectError("This bot has a webhook set, so its messages can't be read here.");
    }
    throw new TelegramDetectError(`Couldn't reach Telegram${err instanceof HttpError ? ` (${err.status})` : ""}.`);
  }
  if (!body.ok) throw new TelegramDetectError(body.description ?? "Telegram refused the request.");

  const seen = new Map<string, TelegramChat>();
  for (const update of [...(body.result ?? [])].reverse()) {
    for (const value of Object.values(update)) {
      const chat = (value as { chat?: RawChat } | null)?.chat;
      if (typeof chat?.id !== "number") continue;
      const id = String(chat.id);
      if (!seen.has(id)) seen.set(id, { id, title: chatTitle(chat), type: chat.type ?? "" });
    }
  }
  return [...seen.values()];
}

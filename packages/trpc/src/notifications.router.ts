import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { errorMessage, REDACTED_SECRET } from "@tinkerbell/core";
import {
  detectTelegramChats,
  EVENT_TYPES,
  NOTIFICATION_SERVICES,
  sampleMessageFor,
  TelegramDetectError,
} from "@tinkerbell/domain.notifications";
import { t, procedure } from "./_base.ts";

const EVENT_IDS = EVENT_TYPES.map((e) => e.id) as [string, ...string[]];

export function createNotificationsRouter(deps: Pick<TrpcDeps, "config" | "notifications">) {
  const { notifications } = deps;
  const { getConfig } = deps.config;
  const { routingMatrix, sendRichNotification } = notifications;

  const notificationsRouter = t.router({
    /**
     * The event × service grid, as the dispatcher would decide it right now.
     *
     * Computed per request rather than cached: "would this go out at this
     * moment" is half of what the page is for, and quiet hours change the
     * answer without anything else changing.
     */
    routing: procedure.query(() => ({ rows: routingMatrix(), services: NOTIFICATION_SERVICES })),

    /**
     * Sends what a given event type would actually look like on a given service.
     *
     * Deliberately bypasses routing and suppression. This is "show me what this
     * renders as", asked by someone looking at the routing table — being told
     * "nothing happened, it's quiet hours" when you pressed a button labelled
     * Test is not a useful answer.
     */
    testEvent: procedure
      .input(z.object({ service: z.enum(NOTIFICATION_SERVICES), type: z.enum(EVENT_IDS) }))
      .mutation(async ({ input }) => {
        try {
          await sendRichNotification(input.service, sampleMessageFor(input.type));
          return { sent: true as const };
        } catch (err) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: errorMessage(err) });
        }
      }),

    /**
     * The chats a Telegram bot has been messaged from, for the "Detect" button
     * beside the chat id. Takes the token from the form so it works before the
     * first save; the redaction sentinel means "the one already stored".
     */
    detectTelegramChats: procedure.input(z.object({ token: z.string() })).mutation(async ({ input }) => {
      const token = input.token === REDACTED_SECRET ? (getConfig("global_telegram_bot_token") ?? "") : input.token;
      if (!token.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter the bot token first." });
      try {
        return { chats: await detectTelegramChats(token.trim()) };
      } catch (err) {
        if (err instanceof TelegramDetectError) throw new TRPCError({ code: "BAD_GATEWAY", message: err.message });
        throw err;
      }
    }),
  });

  return notificationsRouter;
}

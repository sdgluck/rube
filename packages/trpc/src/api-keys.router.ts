import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { API_KEY_NAME_MAX } from "@tinkerbell/domain.api-keys";

import { t, procedure } from "./_base.ts";

/**
 * Settings → API & MCP.
 *
 * Minting and revoking are events rather than change-log entries: a key is not
 * a setting anybody restores to an earlier value, and the question asked after
 * the fact is "who made a key, and when", which is what the events page is for.
 * Both are mutations, so `refuseWritesFromAgents` keeps a key from minting
 * another.
 */
export function createApiKeysRouter(deps: Pick<TrpcDeps, "apiKeys" | "events">) {
  const { listApiKeys, createApiKey, revokeApiKey } = deps.apiKeys;
  const { emitEvent } = deps.events;

  return t.router({
    list: procedure.query(() => listApiKeys()),

    create: procedure
      .input(z.object({ name: z.string().trim().min(1).max(API_KEY_NAME_MAX) }))
      .mutation(({ input, ctx }) => {
        const created = createApiKey(input.name);
        emitEvent("api_key.created", `API key "${created.name}" created`, {
          id: created.id,
          by: ctx.session?.username ?? "",
        });
        return created;
      }),

    revoke: procedure.input(z.object({ id: z.string() })).mutation(({ input, ctx }) => {
      const name = revokeApiKey(input.id);
      if (name === null) throw new TRPCError({ code: "NOT_FOUND", message: "That key has already been revoked." });
      emitEvent("api_key.revoked", `API key "${name}" revoked`, { id: input.id, by: ctx.session?.username ?? "" });
      return { ok: true as const };
    }),
  });
}

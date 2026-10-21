/**
 * The download clients: their live state, pause and resume (whole client or
 * one item), and the settings form's connection test.
 *
 * Every read is live and every failure is the client's, so a client error is a
 * 502 with the client's own words — "rejected the credentials", "didn't answer
 * within 10s" — rather than a generic failure. An id that isn't configured is
 * a 404: it is a stale page after a client was removed, not an upstream fault.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DOWNLOAD_CLIENT_KINDS } from "@rube/contracts";
import { errorMessage } from "@rube/core";
import { downloadClientHealthName, UnknownDownloadClientError } from "@rube/domain.download-clients";
import type { TrpcDeps } from "./deps.ts";
import { t, procedure } from "./_base.ts";

const clientInput = z.object({ id: z.string() });
const itemInput = z.object({ id: z.string(), itemId: z.string() });

async function toClient<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    if (err instanceof UnknownDownloadClientError) throw new TRPCError({ code: "NOT_FOUND", message: err.message });
    throw new TRPCError({ code: "BAD_GATEWAY", message: errorMessage(err) });
  }
}

export function createDownloadClientsRouter(deps: Pick<TrpcDeps, "downloadClients" | "health">) {
  const {
    listDownloadClients,
    downloadClientsOverview,
    testDownloadClient,
    pauseDownloadClient,
    resumeDownloadClient,
    pauseDownload,
    resumeDownload,
  } = deps.downloadClients;
  const { reportHealth } = deps.health;

  return t.router({
    /** Configured clients, for pickers and the settings tab dot. No credentials. */
    list: procedure.query(() => listDownloadClients()),

    /** Each client's state and in-flight items. Never throws for one bad client. */
    overview: procedure.query(() => downloadClientsOverview()),

    pause: procedure.input(clientInput).mutation(({ input }) => toClient(() => pauseDownloadClient(input.id))),
    resume: procedure.input(clientInput).mutation(({ input }) => toClient(() => resumeDownloadClient(input.id))),
    pauseItem: procedure
      .input(itemInput)
      .mutation(({ input }) => toClient(() => pauseDownload(input.id, input.itemId))),
    resumeItem: procedure
      .input(itemInput)
      .mutation(({ input }) => toClient(() => resumeDownload(input.id, input.itemId))),

    /**
     * Never writes config, like every other test button. A saved client's
     * result lands on its health row, as the *Arr tests' do.
     */
    test: procedure
      .input(
        z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          kind: z.enum(DOWNLOAD_CLIENT_KINDS),
          url: z.string().min(1),
          username: z.string().optional(),
          secret: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const health = input.id && input.name ? downloadClientHealthName({ kind: input.kind, name: input.name }) : null;
        try {
          const version = await testDownloadClient(input);
          if (health) reportHealth(health, "ok", `Connected — ${version}`);
          return { version };
        } catch (err) {
          const message = errorMessage(err);
          if (health) reportHealth(health, "error", message);
          throw new TRPCError({ code: "BAD_GATEWAY", message });
        }
      }),
  });
}

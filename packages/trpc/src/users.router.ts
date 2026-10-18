import type { TrpcDeps } from "./deps.ts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  inviteUser,
  createManagedUser,
  addExistingUserToHome,
  OwnerImmutableError,
  UnknownUserError,
  NotSharedError,
} from "@tinkerbell/domain.users";
import { PlexApiError, realSessions } from "@tinkerbell/plex";

import { t, procedure, mapNotConfiguredClient } from "./_base.ts";
import { paginationInput } from "./_pagination.ts";
import { NativeAdmin } from "@tinkerbell/contracts/native-api";

/**
 * plex.tv says most of what it means through the status code, so a bare
 * "request failed" would throw away the only actionable part. Everything
 * unrecognised rethrows — inventing a friendly message for a status we have
 * never seen would just hide it.
 */
function mapPlexError(err: unknown): never {
  if (err instanceof OwnerImmutableError) throw new TRPCError({ code: "FORBIDDEN", message: err.message });
  if (err instanceof UnknownUserError) throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  if (err instanceof NotSharedError) throw new TRPCError({ code: "BAD_REQUEST", message: err.message });

  if (err instanceof PlexApiError) {
    if (err.status === 422) {
      throw new TRPCError({ code: "CONFLICT", message: "This server is already shared with that user." });
    }
    if (err.status === 429) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Plex.tv is rate-limiting this account. Try again in a few minutes.",
      });
    }
    if (err.status === 401 || err.status === 403) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Plex rejected the server token. Check it under Settings → Plex.",
      });
    }
    if (err.status === 404) throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  throw err;
}

async function withPlexErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapPlexError(err);
  }
}

const shareSettingsInput = z.object({
  allowSync: z.boolean().optional(),
  allowTuners: z.boolean().optional(),
  allowChannels: z.boolean().optional(),
  allowCameraUpload: z.boolean().optional(),
});

export function createUsersRouter(deps: Pick<TrpcDeps, "clients" | "config" | "jobs" | "users">) {
  const { reconcileSharingRestrictions } = deps.jobs;
  const { clients } = deps;
  const getPlexClient = mapNotConfiguredClient(clients);
  const { config, users } = deps;
  const {
    syncUsers,
    getLocalUsers,
    getUserDetail,
    listInvites,
    updateUser,
    updateLibraries,
    updateSettings,
    updateContentRatings,
    removeUser,
    cancelInvite,
    acceptInvite,
    declineInvite,
    removeHomeUser,
    setUserPin,
    clearUserPin,
  } = users;
  const { getPersonalizedSharingStatus } = config;

  const usersRouter = t.router({
    list: procedure
      .input(
        paginationInput.extend({
          search: z.string().optional(),
          sort: z.string().optional(),
          sortDir: z.enum(["asc", "desc"]).default("asc"),
        }),
      )
      .output(NativeAdmin.UsersListOutput)
      .query(async ({ input }) => {
        const result = getLocalUsers({
          search: input.search || undefined,
          offset: input.offset,
          limit: input.limit,
          sort: input.sort,
          sortDir: input.sortDir,
        });

        // If cache is empty, sync live and retry
        if (result.total === 0 && !input.search) {
          try {
            const client = getPlexClient();
            await syncUsers(client);
            return getLocalUsers({
              search: input.search || undefined,
              offset: input.offset,
              limit: input.limit,
              sort: input.sort,
              sortDir: input.sortDir,
            });
          } catch {
            return result;
          }
        }

        return result;
      }),

    get: procedure
      .input(z.object({ userId: z.number() }))
      .output(NativeAdmin.UsersGetOutput)
      .query(async ({ input }) => {
        const client = getPlexClient();
        const detail = await withPlexErrors(() => getUserDetail(client, input.userId));
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "No such Plex user." });
        return detail;
      }),

    /**
     * Live sessions for one user, filtered from the single server-wide read.
     *
     * Tinkerbell's own simulated playback is excluded: the stress harness
     * authenticates with the owner's token, so its sessions would otherwise all
     * appear on the owner's user page as films they are watching.
     */
    sessions: procedure
      .input(z.object({ userId: z.number() }))
      .output(NativeAdmin.UsersSessionsOutput)
      .query(async ({ input }) => {
        const client = getPlexClient();
        const sessions = realSessions(await client.getActiveSessions());
        return sessions.filter((s) => s.userId === input.userId);
      }),

    history: procedure
      .input(z.object({ userId: z.number() }).merge(paginationInput))
      .output(NativeAdmin.UsersHistoryOutput)
      .query(async ({ input }) => {
        const client = getPlexClient();
        return client.getWatchHistory({ accountID: String(input.userId), limit: input.limit, offset: input.offset });
      }),

    invites: procedure.query(() => listInvites()),

    update: procedure.input(z.object({ userId: z.number(), name: z.string().optional() })).mutation(({ input }) => {
      updateUser(input.userId, { name: input.name || null });
      return { ok: true };
    }),

    sync: procedure.output(NativeAdmin.UsersSyncOutput).mutation(async () => {
      const client = getPlexClient();
      return syncUsers(client);
    }),

    invite: procedure
      .input(
        z.object({
          email: z.string().email(),
          /** Empty shares every library. */
          librarySectionIds: z.array(z.number()).default([]),
          settings: shareSettingsInput.optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await withPlexErrors(() => inviteUser(client, input));

        // Personalized home screens only hold if every shared user is
        // restricted, so a new share has to be brought under the scheme
        // immediately rather than waiting for the six-hourly sync.
        if (getPersonalizedSharingStatus() === "enabled") {
          const identity = await client.getIdentity();
          await reconcileSharingRestrictions(client, identity.machineIdentifier).catch(() => 0);
        }

        await syncUsers(client);
        return { ok: true };
      }),

    updateLibraries: procedure
      .input(z.object({ userId: z.number(), librarySectionIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await withPlexErrors(() => updateLibraries(client, input.userId, input.librarySectionIds));
        return { ok: true };
      }),

    updateSettings: procedure
      .input(z.object({ userId: z.number() }).merge(shareSettingsInput))
      .mutation(async ({ input }) => {
        const { userId, ...settings } = input;
        const client = getPlexClient();
        await withPlexErrors(() => updateSettings(client, userId, settings));
        return { ok: true };
      }),

    updateContentRatings: procedure
      .input(
        z.object({
          userId: z.number(),
          movies: z.array(z.string()).optional(),
          television: z.array(z.string()).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await withPlexErrors(() =>
          updateContentRatings(client, input.userId, { movies: input.movies, television: input.television }),
        );
        return { ok: true };
      }),

    remove: procedure
      .input(z.object({ userId: z.number(), mode: z.enum(["unshare", "unfriend"]) }))
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await withPlexErrors(() => removeUser(client, input.userId, input.mode));
        return { ok: true };
      }),

    cancelInvite: procedure.input(z.object({ inviteId: z.number() })).mutation(async ({ input }) => {
      const client = getPlexClient();
      await withPlexErrors(() => cancelInvite(client, input.inviteId));
      return { ok: true };
    }),

    acceptInvite: procedure.input(z.object({ inviteId: z.number() })).mutation(async ({ input }) => {
      const client = getPlexClient();
      await withPlexErrors(() => acceptInvite(client, input.inviteId));
      return { ok: true };
    }),

    declineInvite: procedure.input(z.object({ inviteId: z.number() })).mutation(async ({ input }) => {
      const client = getPlexClient();
      await withPlexErrors(() => declineInvite(client, input.inviteId));
      return { ok: true };
    }),

    createManagedUser: procedure.input(z.object({ title: z.string().min(1) })).mutation(async ({ input }) => {
      const client = getPlexClient();
      await withPlexErrors(() => createManagedUser(client, input.title));
      await syncUsers(client);
      return { ok: true };
    }),

    addExistingUserToHome: procedure.input(z.object({ email: z.string().email() })).mutation(async ({ input }) => {
      const client = getPlexClient();
      await withPlexErrors(() => addExistingUserToHome(client, input.email));
      await syncUsers(client);
      return { ok: true };
    }),

    removeHomeUser: procedure.input(z.object({ userId: z.number() })).mutation(async ({ input }) => {
      const client = getPlexClient();
      await withPlexErrors(() => removeHomeUser(client, input.userId));
      return { ok: true };
    }),

    /** The PIN is write-only on Plex's side — it can be set and cleared, never read. */
    setPin: procedure
      .input(z.object({ userId: z.number(), pin: z.string().regex(/^\d{4}$/, "A PIN is four digits.") }))
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await withPlexErrors(() => setUserPin(client, input.userId, input.pin));
        return { ok: true };
      }),

    clearPin: procedure.input(z.object({ userId: z.number() })).mutation(async ({ input }) => {
      const client = getPlexClient();
      await withPlexErrors(() => clearUserPin(client, input.userId));
      return { ok: true };
    }),

    terminateSession: procedure
      .input(z.object({ sessionId: z.string().min(1), reason: z.string().max(200).default("") }))
      .output(NativeAdmin.UsersTerminateSessionOutput)
      .mutation(async ({ input }) => {
        const client = getPlexClient();
        await withPlexErrors(() => client.terminateSession(input.sessionId, input.reason));
        return { ok: true };
      }),
  });

  return usersRouter;
}

import { TRPCError } from "@trpc/server";
import {
  getAllConfigForClient,
  getConfig,
  isValidTimezone,
  setConfig,
  configSchema,
  SECRET_KEYS,
  REDACTED_SECRET,
  type ConfigKey,
  type ConfigValue,
} from "@tinkerbell/core";
import { restartSchedules, schedulerTimezone } from "@tinkerbell/jobs";
import { t, procedure } from "./_base.ts";

/**
 * Auth state is not settings.
 *
 * These keys decide who may call this very procedure, and they have their own
 * mutations in `auth` that check the things that need checking — the owner is
 * re-resolved from Plex rather than asserted, and enabling auth resets the
 * allow-list. Reachable through the generic config writer they would be
 * settable directly, including during the window before auth is switched on,
 * when this procedure answers to anyone who can reach the port. Omitted from
 * the input schema so the transport rejects them outright.
 */
const AUTH_KEYS = {
  admin_auth_enabled: true,
  admin_allowed_user_ids: true,
  admin_plex_client_id: true,
  global_plex_owner_id: true,
  global_plex_owner_username: true,
  global_plex_owner_token_hash: true,
} as const;

type SavableKey = Exclude<ConfigKey, keyof typeof AUTH_KEYS>;

export const configRouter = t.router({
  get: procedure.query(() => getAllConfigForClient()),

  /** The zone every cron schedule is evaluated in, resolved (config → TZ → system). */
  effectiveTimezone: procedure.query(() => ({
    timezone: schedulerTimezone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    explicit: schedulerTimezone() !== undefined,
  })),

  save: procedure.input(configSchema.partial().omit(AUTH_KEYS)).mutation(({ input }) => {
    // Validated here rather than in `configSchema`, which is also used on read
    // — see the note on `global_timezone`. croner throws when it builds a
    // schedule against an unknown zone, and that throw would happen inside
    // `initJobs` at next boot: a crash-loop with no UI left to fix it from.
    if (input.global_timezone !== undefined && !isValidTimezone(input.global_timezone)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `"${input.global_timezone}" is not a known timezone. Use an IANA name such as "Europe/London" or "UTC".`,
      });
    }

    const timezoneChanged = "global_timezone" in input && input.global_timezone !== getConfig("global_timezone");

    // Narrower than `ConfigKey` now that the auth keys are omitted from the
    // input — indexing `input` with a key it can't hold no longer typechecks.
    for (const key of Object.keys(input) as SavableKey[]) {
      const value = input[key];
      if (value === undefined) continue;
      // The form may echo back the redaction sentinel for secrets the user
      // didn't change. Treat that as "keep the stored value".
      if (SECRET_KEYS.has(key) && value === REDACTED_SECRET) continue;
      if (key === "global_llm") {
        const llm = value as ConfigValue<"global_llm">;
        if (llm.apiKey === REDACTED_SECRET) {
          const existing = getConfig("global_llm");
          setConfig("global_llm", { ...llm, apiKey: existing?.apiKey });
          continue;
        }
      }
      setConfig(key, value);
    }

    // croner bakes the timezone in at construction, so the live Cron objects
    // would keep evaluating against the old zone until the next restart.
    if (timezoneChanged) restartSchedules();

    return { ok: true };
  }),
});

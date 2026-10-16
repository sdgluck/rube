import type { TrpcDeps } from "./deps.ts";
import { TRPCError } from "@trpc/server";
import { isPortalComponentId, isUiScale, portalPrerollCardInput } from "@tinkerbell/contracts";
import {
  isValidTimezone,
  configSchema,
  SECRET_KEYS,
  NESTED_SECRET_KEYS,
  REDACTED_SECRET,
  type ConfigKey,
  type ConfigValue,
} from "@tinkerbell/core";

import { validateMqttUrl } from "@tinkerbell/mqtt";
import { t, procedure } from "./_base.ts";
import { createPortalComponents } from "./portal-components.ts";

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

/** An absolute http(s) URL — what Plex will accept as a sign-in forward URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function createConfigRouter(deps: Pick<TrpcDeps, "config" | "health" | "jobs" | "notifications">) {
  const { restartSchedules, schedulerTimezone } = deps.jobs;
  const { config, health } = deps;
  const { getAllConfigForClient, getConfig, setConfig, restoreNestedSecrets } = config;
  const { renameArrHealthServices } = health;
  const { portalComponentStates } = createPortalComponents(deps);

  const configRouter = t.router({
    get: procedure.query(() => getAllConfigForClient()),

    /**
     * Each portal component's switch and whether shared users actually see it,
     * from the same resolver the portal enforces with — so Settings → Portal →
     * Components can say "needs cleanup" rather than a switch that looks on and
     * does nothing.
     */
    portalComponents: procedure.query(() => portalComponentStates()),

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

      // The card's colours are interpolated into the SVG the preroll is drawn
      // from, and its bounds are what the layout was designed to fit. The
      // stored schema is deliberately loose (it also runs on read), so the
      // strict one is applied here as well as on the card's own mutation.
      // It becomes the forward URL of every portal sign-in, so a value Plex
      // can't redirect to locks every user out of the portal at once.
      if (
        input.user_app_public_url !== undefined &&
        input.user_app_public_url.trim() !== "" &&
        !isHttpUrl(input.user_app_public_url.trim())
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The portal address must be a full URL starting with http:// or https://",
        });
      }

      if (input.portal_preroll !== undefined) {
        const parsed = portalPrerollCardInput.partial().safeParse(input.portal_preroll);
        if (!parsed.success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "Invalid card" });
        }
      }

      // The schema takes any string so a retired id can't break reads; a typo
      // or stale client is refused here instead of being stored as a switch
      // that controls nothing.
      const unknownComponent = input.portal_components_hidden?.find((id) => !isPortalComponentId(id));
      if (unknownComponent !== undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `"${unknownComponent}" is not a portal component.` });
      }

      // Checked when switched on, so a half-typed address can still be saved
      // with the integration off. A bad scheme would otherwise surface only as
      // a health error thirty seconds later, in a different part of the app.
      if (input.global_mqtt?.enabled) {
        try {
          validateMqttUrl(input.global_mqtt.url.trim());
        } catch (err) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Broker address: ${(err as Error).message}` });
        }
      }

      // Off-list sizes are refused rather than clamped: the picker only offers
      // the list, so anything else is a stale or hand-rolled client.
      if (input.ui_scale !== undefined && !isUiScale(input.ui_scale)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${input.ui_scale} is not an interface size.` });
      }

      const timezoneChanged = "global_timezone" in input && input.global_timezone !== getConfig("global_timezone");

      // Snapshotted before the write: an extra *Arr instance's health identity is
      // derived from its display name, so a rename has to carry its check history,
      // its mute and any notification routing that named it. See
      // `renameArrHealthServices`.
      const arrInstancesBefore = "global_arr_instances" in input ? (getConfig("global_arr_instances") ?? []) : null;

      // Narrower than `ConfigKey` now that the auth keys are omitted from the
      // input — indexing `input` with a key it can't hold no longer typechecks.
      for (const key of Object.keys(input) as SavableKey[]) {
        const value = input[key];
        if (value === undefined) continue;
        // The form may echo back the redaction sentinel for secrets the user
        // didn't change. Treat that as "keep the stored value".
        if (SECRET_KEYS.has(key) && value === REDACTED_SECRET) continue;
        // Nested secrets round-trip the same way, but the sentinel is a field of
        // a structured value rather than the value itself. One table in core
        // covers all of them, so a new one can't be missed here — which is how
        // the extra *Arr instances' keys came to be sent to the browser in full.
        if (NESTED_SECRET_KEYS.has(key)) {
          setConfig(key, restoreNestedSecrets(key, value as ConfigValue<typeof key>));
          continue;
        }
        setConfig(key, value);
      }

      if (arrInstancesBefore) renameArrHealthServices(arrInstancesBefore);

      // croner bakes the timezone in at construction, so the live Cron objects
      // would keep evaluating against the old zone until the next restart.
      if (timezoneChanged) restartSchedules();

      return { ok: true };
    }),
  });

  return configRouter;
}

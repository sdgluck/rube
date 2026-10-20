/**
 * "What this needs": the prerequisites a job depends on that are set
 * somewhere else, each with where to set it.
 *
 * A feature that can't work used to install, run, and report success while
 * doing nothing — a digest with no channel to go to, overlays with no overlay
 * configured. The settings stay on their own Settings pages (one editor per
 * value); this only says whether they're in place and links there.
 *
 * Every check reads state Tinkerbell already holds. None calls Plex: this runs
 * on every job page view, and an unreachable server is the health page's
 * business.
 */
import { type Services } from "@tinkerbell/composition";
import { isCommandName } from "./commands/catalog.ts";

export type ReadinessItem = {
  id: string;
  label: string;
  met: boolean;
  detail?: string;
  href?: string;
  /** `recommended` is shown, but doesn't make the job "not ready". */
  severity: "required" | "recommended";
};

export function createReadiness(
  deps: Pick<
    Services,
    "backups" | "cleanup" | "config" | "notifications" | "overlays" | "playback" | "preferences" | "recommendations"
  >,
) {
  const { backups, cleanup, config, notifications, overlays, playback, preferences, recommendations } = deps;
  const { getConfig, getLlmConfig, getPersonalizedSharingStatus } = config;

  function plex(): ReadinessItem {
    return {
      id: "plex",
      label: "Plex connected",
      met: Boolean(getConfig("global_plex_url") && getConfig("global_plex_token")),
      href: "/settings/plex",
      severity: "required",
    };
  }

  function personalization(): ReadinessItem {
    return {
      id: "personalization",
      label: "Personalized Home Screens turned on",
      met: getPersonalizedSharingStatus() === "enabled",
      detail: "Keeps each user's collections visible only to them.",
      href: "/settings/portal/personalization",
      severity: "required",
    };
  }

  function ai(detail: string): ReadinessItem {
    return {
      id: "ai",
      label: "AI provider configured",
      met: getLlmConfig() !== undefined,
      detail,
      href: "/settings/ai",
      severity: "required",
    };
  }

  /**
   * The personal rows read Tinkerbell's own playback log, not Plex's history,
   * so a fresh install has nothing to read until the poller has seen some
   * viewing or the one-off import has run.
   */
  function watchHistory(): ReadinessItem {
    const { sessions, days } = playback.watchHistoryCoverage();
    return {
      id: "watch-history",
      label: "Watch history recorded",
      met: sessions > 0,
      detail:
        sessions > 0
          ? `${sessions} play${sessions === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"}.`
          : "Run Import Plex Watch History to start from your past viewing.",
      href: "/jobs/playback-backfill",
      severity: "required",
    };
  }

  function itemsFor(job: { id: string; command: string; config: Record<string, unknown> | null }): ReadinessItem[] {
    const items: ReadinessItem[] = [];
    if (isCommandName(job.command)) items.push(plex());
    const cfg = job.config ?? {};

    switch (job.command) {
      case "because-you-watched":
        items.push(personalization(), ai("Picks the titles in each collection."));
        break;
      case "we-think-youd-like":
        items.push(personalization(), ai("Reads each person's taste and picks the titles."), watchHistory());
        break;
      case "pick-it-back-up":
        items.push(personalization(), watchHistory());
        break;
      case "finish-the-franchise":
        items.push(personalization(), watchHistory(), {
          id: "tmdb",
          label: "TMDb API key set",
          met: Boolean(getConfig("global_tmdb_api_key")),
          detail: "Finds which series each film belongs to, and in what order.",
          href: "/settings/databases/tmdb",
          severity: "required",
        });
        break;
      case "watch-it-again":
        items.push(personalization(), {
          ...watchHistory(),
          detail:
            "Its films were mostly watched before Tinkerbell was installed, so run Import Plex Watch History once.",
        });
        break;
      case "new-for-you": {
        items.push(personalization(), watchHistory());
        const rec = recommendations.status();
        items.push({
          id: "recommender",
          label: "Built-in recommender on",
          met: rec.enabled && rec.available,
          detail: "Orders each row by the person's taste. Without it, rows follow their favourite genres.",
          href: "/settings/ai",
          severity: "recommended",
        });
        break;
      }
      case "more-from":
        items.push(personalization(), watchHistory(), {
          id: "tmdb",
          label: "TMDb API key set",
          met: Boolean(getConfig("global_tmdb_api_key")),
          detail: "Finds who directed and starred in each film, and their other films.",
          href: "/settings/databases/tmdb",
          severity: "required",
        });
        break;
      case "requests-arrived":
        items.push(
          {
            id: "seerr",
            label: "Overseerr connected",
            met: Boolean(getConfig("global_seerr_url") && getConfig("global_seerr_api_key")),
            detail: "Where the requests, and who made them, come from.",
            href: "/settings/arrs/seerr",
            severity: "required",
          },
          personalization(),
          watchHistory(),
        );
        break;
      case "leaving-soon": {
        const refusal = cleanup.standingRefusal();
        items.push({
          id: "cleanup",
          label: "Cleanup able to remove things",
          met: refusal === null,
          detail: refusal ? `Not right now: ${refusal}` : "Only titles a cleanup rule will really delete are shown.",
          href: "/cleanup",
          severity: "required",
        });
        break;
      }
      case "season-collections":
        items.push({
          id: "tmdb",
          label: "TMDb API key set",
          met: Boolean(getConfig("global_tmdb_api_key")),
          detail: "Finds each holiday's titles by the keywords TMDb files them under.",
          href: "/settings/databases/tmdb",
          severity: "required",
        });
        if (cfg.useAi !== false) {
          items.push({ ...ai("Adds titles to a holiday the keywords found too few for."), severity: "recommended" });
        }
        // Only a row per person needs the rows kept apart; the shared row is
        // meant to be seen by everyone.
        if (cfg.mode === "per-user") items.push(personalization(), watchHistory());
        break;
      case "digest": {
        if (cfg.includeServerDigest !== false) {
          const services = notifications.servicesForEvent("digest.sent");
          items.push({
            id: "digest-channel",
            label: "A notification service receives the digest",
            met: services.length > 0,
            detail: services.length > 0 ? `Sent to ${services.join(", ")}.` : undefined,
            href: "/settings/notifications/routing",
            severity: "required",
          });
        }
        if (cfg.includeUserDigests !== false) {
          const subscribers = preferences.listDigestSubscribers().length;
          items.push(
            {
              id: "smtp",
              label: "Email (SMTP) configured",
              met: notifications.smtpConfigured(),
              detail: "Per-user digests are sent by email.",
              href: "/settings/notifications/smtp",
              severity: "required",
            },
            {
              id: "subscribers",
              label: "A portal user has subscribed",
              met: subscribers > 0,
              detail: `${subscribers} subscriber${subscribers === 1 ? "" : "s"}.`,
              href: "/settings/digest",
              severity: "recommended",
            },
          );
        }
        break;
      }
      case "overlays":
        items.push({
          id: "overlay-configs",
          label: "Overlays configured for a library",
          met: overlays.hasAnyOverlayConfig(),
          href: "/overlays",
          severity: "required",
        });
        break;
      case "backup":
        items.push({
          id: "backups-enabled",
          label: "Backups turned on",
          met: backups.backupsEnabled(),
          href: "/settings/backup",
          severity: "required",
        });
        break;
    }
    return items;
  }

  return { readinessFor: itemsFor };
}

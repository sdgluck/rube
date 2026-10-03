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
import { parseRuleConfig } from "./commands/generate/config.ts";

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
  deps: Pick<Services, "backups" | "config" | "notifications" | "overlays" | "preferences" | "rules">,
) {
  const { backups, config, notifications, overlays, preferences, rules } = deps;
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

  function optedInUsers(): ReadinessItem {
    const count = preferences.listOptedInUserPreferences().length;
    return {
      id: "opted-in",
      label: "At least one user has opted in",
      met: count > 0,
      detail: `${count} user${count === 1 ? "" : "s"} opted in through the portal.`,
      href: "/settings/portal",
      severity: "required",
    };
  }

  function itemsFor(job: { id: string; command: string; config: Record<string, unknown> | null }): ReadinessItem[] {
    const items: ReadinessItem[] = [];
    if (isCommandName(job.command)) items.push(plex());
    const cfg = job.config ?? {};

    switch (job.command) {
      case "because-you-watched":
        items.push(personalization(), {
          id: "ai",
          label: "AI provider configured",
          met: getLlmConfig() !== undefined,
          detail: "Picks the titles in each collection.",
          href: "/settings/ai",
          severity: "required",
        });
        break;
      case "personalize": {
        const count = rules.getEnabledRules().filter((r) => parseRuleConfig(r).personalizable).length;
        items.push(personalization(), optedInUsers(), {
          id: "personalizable-rules",
          label: "At least one rule marked personalizable",
          met: count > 0,
          detail: `${count} enabled rule${count === 1 ? "" : "s"} marked personalizable.`,
          href: "/rules",
          severity: "required",
        });
        break;
      }
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

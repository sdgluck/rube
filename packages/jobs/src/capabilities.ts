import { type Services } from "@rube/composition";
import { HEALTH_SERVICES } from "@rube/domain.health";
import { anyNotifierConfigured } from "@rube/domain.onboarding";
import type { ScheduleCapabilities } from "@rube/contracts";

/**
 * Which of the services a job can depend on are set up here.
 *
 * Every answer already existed somewhere — the health page knows whether
 * Overseerr is configured, onboarding knows whether a notifier is, the *Arr
 * registry knows its instances — but each was asked in its own words in its
 * own place, and the schedule page needs all of them at once to say "Digest is
 * scheduled but has nowhere to send anything". So this asks the same sources,
 * rather than growing a sixth way to decide.
 */
export function createCapabilities(deps: Pick<Services, "config" | "arr" | "backups">) {
  const { config, arr, backups } = deps;

  function scheduleCapabilities(): ScheduleCapabilities {
    const all = config.getAllConfig();
    const seerr = HEALTH_SERVICES.find((s) => s.service === "Seerr");
    return {
      seerr: seerr ? seerr.configuredFn(all) : false,
      arr: arr.arrInstances().length > 0,
      personalizedSharing: config.getPersonalizedSharingStatus() === "enabled",
      watchlist: !!all.watchlist_sync?.enabled,
      notifier: anyNotifierConfigured(all),
      backups: backups.backupsEnabled(),
    };
  }

  return { scheduleCapabilities };
}

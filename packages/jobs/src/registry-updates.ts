import { type Services } from "@tinkerbell/composition";
/**
 * The scheduled half of the registry update check.
 *
 * `checkForUpdates` has existed since registry rules did, but it only ever ran
 * when someone opened the Registry page — so an update to a pack you imported
 * six months ago was discoverable and never discovered. This runs it daily and
 * says something the first time each new version appears.
 *
 * Announcement state lives in `registry_announced_updates` rather than being
 * derived: without it every daily run would re-announce the same pending
 * update forever, which is how a useful event becomes one people filter out.
 */
import { errorMessage } from "@tinkerbell/core";

export function createRegistryUpdates(deps: Pick<Services, "config" | "events" | "registry">) {
  const { config, events, registry } = deps;
  const { getConfig, setConfig } = config;
  const { emitEvent } = events;
  const { checkForUpdates } = registry;

  async function announceRegistryUpdates(): Promise<string> {
    let updates;
    try {
      updates = await checkForUpdates();
    } catch (err) {
      // Plenty of installs have no outbound internet. That is a fact about the
      // network, not a job failure worth a red run in the history every night.
      return `Registry update check skipped: ${errorMessage(err)}`;
    }

    const announced = getConfig("registry_announced_updates") ?? {};
    // Rebuilt from scratch each run rather than merged, so a rule whose update
    // has been applied (or whose pack was withdrawn) drops out — and a version
    // published later announces again instead of being suppressed by a stale key.
    const next: Record<string, number> = {};
    const fresh = [];

    for (const update of updates) {
      next[update.ruleId] = update.toVersion;
      if (announced[update.ruleId] !== update.toVersion) fresh.push(update);
    }

    setConfig("registry_announced_updates", next);

    if (fresh.length === 0) {
      return updates.length === 0
        ? "No registry updates available."
        : `${updates.length} registry update(s) available, already announced.`;
    }

    for (const update of fresh) {
      emitEvent(
        "registry.update_available",
        `"${update.ruleName}" has an update available (v${update.fromVersion} → v${update.toVersion})${
          update.locallyModified ? " — this rule has local edits, so the update won't be applied automatically" : ""
        }`,
        {
          ruleId: update.ruleId,
          ruleName: update.ruleName,
          packSlug: update.packSlug,
          fromVersion: update.fromVersion,
          toVersion: update.toVersion,
          locallyModified: update.locallyModified,
        },
      );
    }

    return `Announced ${fresh.length} new registry update(s) (${updates.length} available in total).`;
  }

  return { announceRegistryUpdates };
}

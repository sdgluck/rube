import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createPlexClient } from "@tinkerbell/plex";
import { errorMessage } from "@tinkerbell/core";
import { sharingRestrictionBackups } from "@tinkerbell/db";
import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

const BASELINE_LABEL = "Tinkerbell";

/**
 * Fewest items a pass must label before its speed is worth remembering. A
 * reconcile that labels three new films is dominated by the listing walk, and
 * recording its rate would make the next full enable's estimate absurd.
 */
const MIN_ITEMS_TO_MEASURE = 200;

export function createPersonalizeEnableCommand(deps: Pick<Services, "clients" | "config" | "db">) {
  const { clients, config, db } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig, setConfig } = config;

  /**
   * Enable the personalization master switch: stamp the `Tinkerbell` label on
   * every item (so restricted users keep full library access) and restrict
   * every shared user to `[Tinkerbell, User:<self>]`. This is what makes
   * per-user collections visible only to their owner.
   *
   * Idempotent: re-running reconciles any users that aren't yet restricted
   * (e.g. newly shared) without clobbering the original-state snapshot.
   */
  async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;
    if (!PLEX_TOKEN) {
      throw new Error("Plex token is required. Configure it in Settings.");
    }

    const prior = getConfig("global_personalized_sharing");
    setConfig("global_personalized_sharing", { status: "enabling", enabledAt: prior?.enabledAt });

    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });

    ctx.log(`tinkerbell personalize-enable`);
    const identity = await client.getIdentity();
    const machineId = identity.machineIdentifier;
    ctx.log(`Server: ${identity.friendlyName}`);

    let sections = await client.getSections();
    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      sections = sections.filter((s) => configuredLibraries.includes(s.title));
    }
    if (config.sections && config.sections.length > 0) {
      sections = sections.filter((s) => config.sections!.includes(s.title));
    }

    try {
      // Phase 1: snapshot each user's CURRENT restriction before we change it.
      // onConflictDoNothing keeps the original snapshot intact across re-runs.
      const sharings = await client.getSharings(machineId);
      const details = await client.getSharedServerDetails(machineId);
      const detailFor = (userId: number) => details.find((d) => d.userId === userId);
      ctx.log(`Snapshotting sharing restrictions for ${sharings.length} user(s)...`);
      for (const s of sharings) {
        const d = detailFor(s.userId);
        db.insert(sharingRestrictionBackups)
          .values({
            sharingId: s.id,
            userId: s.userId,
            username: s.username,
            filterMovies: d?.filterMovies ?? "",
            filterTelevision: d?.filterTelevision ?? "",
            capturedAt: Date.now(),
          })
          .onConflictDoNothing()
          .run();
      }

      // Phase 2: label every item so restricted users retain library access.
      // Only items missing the label are touched, so a reconcile after a full
      // enable is a few listing requests rather than the whole library again.
      ctx.log(`Labelling items not yet labelled "${BASELINE_LABEL}"...`);
      const labelStart = Date.now();
      let labelled = 0;
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const updated = await client.addLabelToAllItems(section.key, section.type, BASELINE_LABEL, (current, total) => {
          ctx.progress(current, total, `Labelling "${section.title}" (${i + 1}/${sections.length})...`);
        });
        labelled += updated;
        ctx.log(`Labelled ${updated} item(s) in "${section.title}"`);
      }
      const labelSeconds = (Date.now() - labelStart) / 1000;
      if (labelled >= MIN_ITEMS_TO_MEASURE && labelSeconds > 0) {
        const itemsPerSecond = labelled / labelSeconds;
        setConfig("personalize_label_rate", { itemsPerSecond, items: labelled, measuredAt: Date.now() });
        ctx.log(`Labelling ran at ${itemsPerSecond.toFixed(1)} items/s.`);
      }

      // Phase 3: restrict every shared user to [Tinkerbell, User:<self>].
      ctx.log(`Applying sharing restrictions...`);
      let configured = 0;
      for (let i = 0; i < sharings.length; i++) {
        const s = sharings[i];
        ctx.progress(i + 1, sharings.length, `Restricting "${s.username}"...`);
        try {
          // Pass the snapshotted filters so any content-rating clause the
          // admin set survives the label rewrite.
          await client.setSharingRestrictions(s.id, [BASELINE_LABEL, `User:${s.username}`], detailFor(s.userId));
          configured++;
        } catch (err) {
          ctx.log(`Failed to restrict ${s.username}: ${errorMessage(err)}`);
        }
      }
      ctx.log(`Restricted ${configured}/${sharings.length} user(s).`);

      setConfig("global_personalized_sharing", {
        status: "enabled",
        enabledAt: prior?.enabledAt ?? Date.now(),
        lastReconcileAt: Date.now(),
      });
      ctx.log(`Personalization enabled.`);
    } catch (err) {
      // Leave status as "enabling" so the UI shows it's incomplete and a
      // re-run can finish the job (every phase above is idempotent).
      ctx.log(`Enable failed: ${errorMessage(err)}`);
      throw err;
    }
  }

  return { run };
}

/**
 * The command entrypoint, unchanged in shape: the runner and the Sidequest
 * worker both still call `default(ctx, config)`. What changed is where the
 * work gets its dependencies — the run's own container scope, rather than
 * whatever the module graph happened to have initialised.
 */
export default function run(
  ctx: JobContext,
  config: Parameters<ReturnType<typeof createPersonalizeEnableCommand>["run"]>[1],
): Promise<void> {
  return createPersonalizeEnableCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}

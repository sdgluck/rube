import { ServicesToken, type Services } from "@tinkerbell/composition";
import { createRuleTriggers } from "../rule-triggers.ts";
import { createPlexClient, type PlexClient, type PlexSection } from "@tinkerbell/plex";
import { errorMessage } from "@tinkerbell/core";
import { BASELINE_LABEL } from "../personalize/reconcile.ts";

import type { JobContext, CommonJobConfig } from "@tinkerbell/core";

interface SyncMediaCheckpoint {
  /** The `syncedAt` watermark the interrupted run stamped its rows with. */
  syncedAt: number;
  /** The full section list at the time — a different one invalidates the checkpoint. */
  sectionKeys: string[];
  completedSectionKeys: string[];
}

function sameSections(saved: string[], current: { key: string }[]): boolean {
  if (saved.length !== current.length) return false;
  const keys = new Set(current.map((s) => s.key));
  return saved.every((k) => keys.has(k));
}

export function createSyncMediaCommand(deps: Services) {
  const { arr, arrLibrary, clients, config, media } = deps;
  const { plexHealthCallback } = clients;
  const { getConfig } = config;
  const { syncMedia } = media;
  const { runTriggeredRules } = createRuleTriggers(deps);

  /**
   * Re-join the *Arr mirror to Plex, now that the Plex rows have moved.
   *
   * `linkToPlex` matches on `media_items.tmdb_id`/`tvdb_id`/`imdb_id`, and this
   * job is the only thing that writes those columns — so a link computed before
   * this run was computed against the previous library. It only ran from the
   * *Arr sync, which meant the two jobs had to be run in the right order for
   * the library to be right: on the install that added the provider-id columns,
   * every mirror row read "Not in Plex" until someone happened to sync an *Arr
   * next. It is two indexed statements per instance over local tables, so
   * running it unconditionally costs less than explaining the ordering.
   *
   * Scoped-to-one-section runs relink too: the join is over the whole mirror
   * either way, and a section holding no *Arr-managed titles just matches
   * nothing.
   */
  function relinkArr(ctx: JobContext): void {
    const instances = arr.arrInstances();
    if (instances.length === 0) return;

    let linked = 0;
    let total = 0;
    for (const instance of instances) {
      linked += arrLibrary.linkToPlex(instance.id, instance.service);
      total += arrLibrary.library({ service: instance.service, instanceId: instance.id, pageSize: 1 }).total;
    }
    ctx.log(`Relinked ${instances.length} *Arr instance(s) to Plex: ${linked} of ${total} record(s) matched.`);
  }

  /**
   * Give new arrivals the personalization label.
   *
   * With personalization on, every shared user's filter is
   * `label=Tinkerbell,User:<them>`, so an item without the baseline label is
   * invisible to all of them. Only the enable job and its Reconcile button
   * labelled anything, and neither runs on a schedule — every film and show
   * added after the last reconcile stayed hidden until someone noticed it was
   * missing and pressed the button. This job already walks every library on a
   * schedule, so it closes the gap.
   *
   * `addLabelToAllItems` asks Plex for `label!=Tinkerbell` and so touches only
   * what is missing; on a library that is up to date it costs one listing per
   * section. Not while enabling (that job is already labelling) or disabling
   * (this would put back what it is taking off).
   *
   * A failure is logged rather than thrown: the sync above has committed, and
   * failing the run for a straggler label would also skip the relink and the
   * rule triggers. The next run picks the stragglers up through the filter.
   */
  async function labelNewArrivals(ctx: JobContext, client: PlexClient, sections: PlexSection[]): Promise<void> {
    if (getConfig("global_personalized_sharing")?.status !== "enabled") return;

    let labelled = 0;
    for (const section of sections) {
      try {
        labelled += await client.addLabelToAllItems(section.key, section.type, BASELINE_LABEL);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        ctx.log(`Failed to label new items in "${section.title}" for personalization: ${errorMessage(err)}`);
      }
    }
    if (labelled > 0) ctx.log(`Labelled ${labelled} new item(s) "${BASELINE_LABEL}" so shared users can see them.`);
  }

  async function run(ctx: JobContext, config: CommonJobConfig): Promise<void> {
    const PLEX_URL = getConfig("global_plex_url") || process.env.PLEX_URL || "http://localhost:32400";
    const PLEX_TOKEN = getConfig("global_plex_token") || process.env.PLEX_TOKEN;

    if (!PLEX_TOKEN) {
      throw new Error("Plex token is required. Configure it in Settings.");
    }

    const client = createPlexClient({
      url: PLEX_URL,
      token: PLEX_TOKEN,
      signal: ctx.signal,
      onHealth: plexHealthCallback,
    });

    ctx.log(`tinkerbell sync-media`);
    ctx.log(`Server: ${PLEX_URL}`);

    const identity = await client.getIdentity();
    ctx.log(`Server name: ${identity.friendlyName}`);

    let allSections = await client.getSections();

    const configuredLibraries = getConfig("global_plex_libraries");
    if (configuredLibraries) {
      allSections = allSections.filter((s) => configuredLibraries.includes(s.title));
    }

    let sections;
    if (config.sections && config.sections.length > 0) {
      const names = config.sections.map((s) => s.trim().toLowerCase());
      sections = allSections.filter((s) => names.includes(s.key) || names.includes(s.title.toLowerCase()));
      if (sections.length === 0) {
        throw new Error(`No matching sections found for "${config.sections.join(", ")}".`);
      }
    } else {
      sections = allSections;
    }

    ctx.log(`Sections: ${sections.map((s) => s.title).join(", ")}`);

    // Resume a sync the previous run abandoned. Section granularity: the
    // per-item seam inside `syncMedia` isn't clean (paging state lives in the
    // Plex client's iterator), and a section is a small enough unit that
    // redoing one costs little.
    //
    // The watermark carries across runs deliberately — see `SyncMediaOptions`.
    const saved = ctx.checkpoint.read<SyncMediaCheckpoint>();
    const resumable = saved && sameSections(saved.sectionKeys, sections);
    if (saved && !resumable) {
      ctx.log("Section selection changed since the last run — starting from scratch.");
    }
    const syncedAt = resumable ? saved.syncedAt : Date.now();
    const done = resumable ? saved.completedSectionKeys : [];
    if (done.length > 0) {
      ctx.log(`Resuming: skipping ${done.length} section(s) completed in the previous run.`);
    }

    ctx.log(`Syncing media items...`);

    const completed = [...done];
    const stats = await syncMedia(
      client,
      sections,
      (current, total, message) => ctx.progress(current, total, message),
      {
        syncedAt,
        skipSectionKeys: completed,
        // Every library this install manages, not just the ones this run walked, so
        // a job scoped to one section doesn't sweep away the others' rows.
        knownSectionKeys: allSections.map((s) => s.key),
        onSectionComplete: (sectionKey) => {
          completed.push(sectionKey);
          ctx.checkpoint.write({
            syncedAt,
            sectionKeys: sections.map((s) => s.key),
            completedSectionKeys: completed,
          } satisfies SyncMediaCheckpoint);
        },
      },
    );

    // The stale sweep has run, so there is nothing left to resume.
    ctx.checkpoint.clear();
    ctx.log(`Done! Synced ${stats.synced} item(s), removed ${stats.removed} stale.`);

    await labelNewArrivals(ctx, client, sections);

    // Before the rule triggers below, so a rule that asks "is this in Plex?"
    // sees the freshly-computed answer rather than the previous run's.
    relinkArr(ctx);

    // The removed-item trigger rides on this job for the same reason the added
    // one rides on the recently-added sync: this is already the thing that knows
    // what vanished. It runs after the checkpoint is cleared, so a rule that
    // fails here doesn't cost the sync its resumability.
    const triggered = await runTriggeredRules(ctx, "item-removed", stats.removed);
    if (triggered) ctx.log(triggered);
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
  config: Parameters<ReturnType<typeof createSyncMediaCommand>["run"]>[1],
): Promise<void> {
  return createSyncMediaCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}

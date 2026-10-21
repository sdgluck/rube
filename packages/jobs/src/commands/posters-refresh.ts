import { ServicesToken, type Services } from "@rube/composition";
import type { CommonJobConfig, JobContext } from "@rube/core";

export function createPostersRefreshCommand(deps: Pick<Services, "posters">) {
  const { posters } = deps;
  const { refreshPosterCache } = posters;

  async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
    ctx.log("rube posters-refresh");

    const summary = await refreshPosterCache({
      signal: ctx.signal,
      onProgress: ({ current, total, url }) => {
        ctx.progress(current, total, `Checking ${current}/${total}: ${url}`);
      },
    });

    if (summary.total === 0) {
      ctx.log("Poster cache empty — nothing to refresh.");
      return;
    }

    ctx.log(
      `Refreshed ${summary.total} cached poster(s): ${summary.unchanged} unchanged, ${summary.updated} updated, ${summary.removed} removed, ${summary.missing} still missing, ${summary.failed} failed.`,
    );
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
  config: Parameters<ReturnType<typeof createPostersRefreshCommand>["run"]>[1],
): Promise<void> {
  return createPostersRefreshCommand(ctx.scope.resolve(ServicesToken)).run(ctx, config);
}

import type { CommonJobConfig, JobContext } from "@tinkerbell/core";
import { refreshPosterCache } from "@tinkerbell/core";

export default async function run(ctx: JobContext, _config: CommonJobConfig): Promise<void> {
  ctx.log("tinkerbell posters-refresh");

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

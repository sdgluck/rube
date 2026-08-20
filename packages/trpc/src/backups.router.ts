import type { TrpcDeps } from "./deps.ts";

import { t, procedure } from "./_base.ts";

/**
 * What the Backups tab reads.
 *
 * There is deliberately no `restore` mutation. Restoring means replacing the
 * file the process has open, and a button that does that while every domain
 * holds a live connection is a reliable way to end up with two corrupt
 * databases instead of one good backup. The procedure is documented in the
 * README and shown inline on the page: stop the container, swap the file,
 * start it.
 *
 * Taking a backup isn't here either — it is a job (`backup`), started through
 * `jobs.start` like every other, so it gets a run row, a log and the same
 * cancel button as the rest rather than a bespoke spinner.
 */
export function createBackupsRouter(deps: Pick<TrpcDeps, "backups">) {
  const { listBackups, backupsEnabled, backupDir } = deps.backups;

  const backupsRouter = t.router({
    list: procedure.query(async () => ({
      enabled: backupsEnabled(),
      // Surfaced so the page can say *where* they are. Inside a container this
      // is the single most common thing to get wrong — a directory outside the
      // mounted volume produces backups that die with the container, and the
      // only way to notice is to be told the path.
      directory: backupDir(),
      files: await listBackups(),
    })),
  });

  return backupsRouter;
}

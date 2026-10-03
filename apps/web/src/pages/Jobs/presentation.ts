import { configSchemaFor, isAlwaysOnJob, jobPresentation } from "@tinkerbell/contracts";

/**
 * Everything the Jobs pages need to know about how to show a job, derived from
 * the shared tables in contracts rather than a list kept here.
 *
 * `sections` comes from the command's own config schema: a job shows a library
 * picker exactly when its command reads one, so the picker can't drift from
 * what the job does (posters-refresh used to show one it ignored).
 */
export function jobUi(job: { id: string; command: string }) {
  const presentation = jobPresentation(job.id);
  return {
    ...presentation,
    enabled: isAlwaysOnJob(job.id) ? ("required" as const) : ("toggleable" as const),
    sections: "sections" in configSchemaFor(job.command).shape,
  };
}

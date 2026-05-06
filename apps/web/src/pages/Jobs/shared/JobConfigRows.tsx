import type { Job } from "#pages/Jobs/types";
import { getJobFields } from "#pages/Jobs/fields";
import ScheduleRow from "./rows/ScheduleRow";
import EnabledRow from "./rows/EnabledRow";
import SectionsRow from "./rows/SectionsRow";

interface Props {
  job: Job;
  sections?: { value: string[]; onChange: (next: string[]) => void };
}

/** Renders the standard schedule/enabled/sections rows according to the job's fields descriptor. */
export default function JobConfigRows({ job, sections }: Props) {
  const fields = getJobFields(job.id);
  return (
    <>
      {fields.schedule !== "hidden" && <ScheduleRow jobId={job.id} schedule={job.schedule} />}
      {fields.enabled === "toggleable" && <EnabledRow jobId={job.id} enabled={!!job.enabled} />}
      {fields.sections && sections && <SectionsRow selected={sections.value} onChange={sections.onChange} />}
    </>
  );
}

export { getJobFields };

import { useParams } from "react-router-dom";
import { trpc } from "#/trpc";
import { DetailSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import { resolveJobComponent } from "./registry";

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const job = jobsQuery.data?.find((j) => j.id === jobId);

  if (jobsQuery.isLoading) return <DetailSkeleton />;
  if (jobsQuery.error) {
    return <ErrorState title="Couldn't load this job" error={jobsQuery.error} onRetry={() => jobsQuery.refetch()} />;
  }
  if (!job) return <p>Job not found</p>;

  const Component = resolveJobComponent(job.command);
  return <Component job={job} />;
}

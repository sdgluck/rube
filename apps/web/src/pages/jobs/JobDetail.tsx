import { useParams } from "react-router-dom";
import { trpc } from "../../trpc";
import { DetailSkeleton } from "../../Skeleton";
import { resolveJobComponent } from "./registry";

export default function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const job = jobsQuery.data?.find((j) => j.id === jobId);

  if (jobsQuery.isLoading) return <DetailSkeleton />;
  if (!job) return <p>Job not found</p>;

  const Component = resolveJobComponent(job.command);
  return <Component job={job} />;
}

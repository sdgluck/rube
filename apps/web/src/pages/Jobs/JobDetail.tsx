import { Link, useParams } from "react-router-dom";
import { isFeatureId, jobPresentation } from "@rube/contracts";
import { trpc } from "#/trpc";
import { DetailSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import EmptyState from "#components/EmptyState";
import { resolveJobComponent } from "./registry";

export default function JobDetail() {
  const { jobId = "" } = useParams<{ jobId: string }>();
  const jobsQuery = trpc.jobs.list.useQuery(undefined, { refetchInterval: 5000 });
  const job = jobsQuery.data?.find((j) => j.id === jobId);

  if (jobsQuery.isLoading) return <DetailSkeleton />;
  if (jobsQuery.error) {
    return <ErrorState title="Couldn't load this job" error={jobsQuery.error} onRetry={() => jobsQuery.refetch()} />;
  }
  if (!job) {
    // The usual way here is a link to a feature that isn't installed — Settings
    // → Digest links to the Digest job — so say that rather than "not found".
    return isFeatureId(jobId) ? (
      <EmptyState
        icon="cog"
        title="This feature isn't installed"
        description={jobPresentation(jobId).description}
        action={<Link to="/jobs">Install it from Jobs → Add Feature</Link>}
      />
    ) : (
      <EmptyState icon="cog" title="No such job" action={<Link to="/jobs">Back to Jobs</Link>} />
    );
  }

  const Component = resolveJobComponent(job.command);
  return <Component job={job} />;
}

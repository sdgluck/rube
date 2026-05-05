import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/src/trpc/index.ts";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type Job = RouterOutputs["jobs"]["list"][number];

export interface JobPageProps {
  job: Job;
}

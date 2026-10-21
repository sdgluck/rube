import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@rube/trpc";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type StressRun = NonNullable<RouterOutputs["stressTest"]["run"]>;
export type StressRunSummary = RouterOutputs["stressTest"]["runs"][number];
export type StressActiveRun = NonNullable<RouterOutputs["stressTest"]["activeRun"]>;
export type StressStep = StressRun["steps"][number];
export type StressSample = StressRun["telemetry"][number];
export type StressSessionReading = StressSample["sessions"][number];

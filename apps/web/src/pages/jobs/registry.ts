import type { ComponentType } from "react";
import type { JobPageProps } from "./types";
import DefaultJob from "./DefaultJob";
import GenerateJob from "./GenerateJob";
import PurgeRunsJob from "./PurgeRunsJob";
import BecauseYouWatchedJob from "./BecauseYouWatched";

const registry: Record<string, ComponentType<JobPageProps>> = {
  generate: GenerateJob,
  "purge-runs": PurgeRunsJob,
  "because-you-watched": BecauseYouWatchedJob,
};

export function resolveJobComponent(command: string): ComponentType<JobPageProps> {
  return registry[command] ?? DefaultJob;
}

import type { ComponentType } from "react";
import type { JobPageProps } from "./types";
import DefaultJob from "./DefaultJob";
import GenerateJob from "./GenerateJob";
import BecauseYouWatchedJob from "./BecauseYouWatched";

const registry: Record<string, ComponentType<JobPageProps>> = {
  generate: GenerateJob,
  // Same engine, same settings — only the rules they link to differ.
  cleanup: GenerateJob,
  metadata: GenerateJob,
  "because-you-watched": BecauseYouWatchedJob,
};

export function resolveJobComponent(command: string): ComponentType<JobPageProps> {
  return registry[command] ?? DefaultJob;
}

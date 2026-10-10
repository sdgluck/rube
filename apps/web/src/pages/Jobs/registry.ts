import type { ComponentType } from "react";
import type { JobPageProps } from "./types";
import DefaultJob from "./DefaultJob";
import GenerateJob from "./GenerateJob";
import BecauseYouWatchedJob from "./BecauseYouWatched";
import WeThinkYoudLikeJob from "./WeThinkYoudLike";

const registry: Record<string, ComponentType<JobPageProps>> = {
  generate: GenerateJob,
  // Same engine, same settings — only the rules they link to differ.
  cleanup: GenerateJob,
  metadata: GenerateJob,
  "because-you-watched": BecauseYouWatchedJob,
  "we-think-youd-like": WeThinkYoudLikeJob,
};

export function resolveJobComponent(command: string): ComponentType<JobPageProps> {
  return registry[command] ?? DefaultJob;
}

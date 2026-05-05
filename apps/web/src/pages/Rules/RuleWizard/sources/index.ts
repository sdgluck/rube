import type { ComponentType } from "react";
import type { SourceStepProps } from "#pages/Rules/RuleWizard/types.ts";
import AiPromptSource from "./AiPromptSource.tsx";
import ImdbChartSource from "./ImdbChartSource.tsx";
import ImdbListSource from "./ImdbListSource.tsx";
import ListSource from "./ListSource.tsx";
import SmartFilterSource from "./SmartFilterSource.tsx";
import SeerrRequestsSource from "./SeerrRequestsSource.tsx";

/**
 * Rule types that show a dedicated Source step in the wizard. Adding a
 * new entry here is the only wiring needed to surface a new per-type
 * source UI; the wizard's step-list and dispatch read from this map.
 */
export const SOURCE_STEPS: Record<string, ComponentType<SourceStepProps>> = {
  ai_prompt: AiPromptSource,
  imdb_chart: ImdbChartSource,
  imdb_list: ImdbListSource,
  list_source: ListSource,
  smart_filter: SmartFilterSource,
  seerr_requests: SeerrRequestsSource,
};

export function hasSourceStep(type: string): boolean {
  return type in SOURCE_STEPS;
}

import type { ComponentType } from "react";
import type { SourceStepProps } from "#pages/Rules/RuleWizard/types.ts";
import AiPromptSource from "./AiPromptSource.tsx";
import ImdbChartSource from "./ImdbChartSource.tsx";
import ImdbListSource from "./ImdbListSource.tsx";
import ListSource from "./ListSource.tsx";
import SmartFilterSource from "./SmartFilterSource.tsx";
import SeerrRequestsSource from "./SeerrRequestsSource.tsx";
import type { SourceStepType } from "./step-types.ts";

export { hasSourceStep, SOURCE_STEP_TYPES, type SourceStepType } from "./step-types.ts";

/**
 * The Source step component for each rule type that has one. The list of
 * types lives in `./step-types.ts`; typing the map against it means adding a
 * type there without a component here fails the typecheck.
 */
export const SOURCE_STEPS: Record<SourceStepType, ComponentType<SourceStepProps>> = {
  ai_prompt: AiPromptSource,
  imdb_chart: ImdbChartSource,
  imdb_list: ImdbListSource,
  list_source: ListSource,
  smart_filter: SmartFilterSource,
  seerr_requests: SeerrRequestsSource,
};

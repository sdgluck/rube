import type { MigrationProvider } from "../types.ts";
import { detectKometa } from "./detect.ts";
import { classifyCollections } from "./classify.ts";
import { buildPlan } from "./plan.ts";

export const kometaProvider: MigrationProvider = {
  id: "kometa",
  detect: detectKometa,
  classify: classifyCollections,
  buildPlan,
};

export { detectKometa, isKometaClaimed } from "./detect.ts";
export { classifyCollections, classifyOne } from "./classify.ts";
export { buildPlan, BUCKET_LABEL } from "./plan.ts";

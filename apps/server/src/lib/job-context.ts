import { z } from "zod";

export interface JobContext {
  log: (...args: unknown[]) => void;
  progress: (current: number, total: number, message: string) => void;
  signal: AbortSignal;
}

export const commonJobConfigSchema = z.object({
  sections: z.array(z.string()).optional(),
});
export type CommonJobConfig = z.infer<typeof commonJobConfigSchema>;

export const generateJobConfigSchema = commonJobConfigSchema;
export type GenerateJobConfig = z.infer<typeof generateJobConfigSchema>;

export const bywJobConfigSchema = commonJobConfigSchema.extend({
  limit: z.number().optional(),
});
export type BywJobConfig = z.infer<typeof bywJobConfigSchema>;

export const overlaysJobConfigSchema = commonJobConfigSchema.extend({
  mode: z.enum(["apply", "remove"]).optional(),
});
export type OverlaysJobConfig = z.infer<typeof overlaysJobConfigSchema>;

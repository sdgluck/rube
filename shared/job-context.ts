export interface JobContext {
  log: (...args: unknown[]) => void;
  progress: (current: number, total: number, message: string) => void;
  signal: AbortSignal;
}

export interface CommonJobConfig {
  sections?: string[];
}

export interface GenerateJobConfig extends CommonJobConfig {}

export interface BywJobConfig extends CommonJobConfig {
  limit?: number;
}

export interface OverlaysJobConfig extends CommonJobConfig {
  mode?: "apply" | "remove";
}

export interface StressTestJobConfig extends CommonJobConfig {
  mode?: "transcode" | "directplay" | "mixed";
  transcodePct?: number;
  maxSessions?: number;
}

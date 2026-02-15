export interface JobContext {
  log: (...args: unknown[]) => void;
  progress: (current: number, total: number, message: string) => void;
  signal: AbortSignal;
}

export interface CommonJobConfig {
  sections?: string[];
}

export interface GenerateJobConfig extends CommonJobConfig {
  limit?: number;
}

export interface BywJobConfig extends CommonJobConfig {
  limit?: number;
}

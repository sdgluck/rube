import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@rube/trpc";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type Preroll = RouterOutputs["prerolls"]["list"][number];
export type PrerollEnvironment = RouterOutputs["prerolls"]["environment"];
export type PrerollPlexStatus = RouterOutputs["prerolls"]["plexStatus"];
export type PrerollMode = "random" | "sequential";

/** A file being uploaded, before it has a row of its own to poll for. */
export type UploadItem = {
  /** Stable key for the list — the File object isn't one. */
  key: string;
  filename: string;
  progress: number;
  error?: string;
};

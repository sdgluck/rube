import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@rube/trpc";

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type Collection = RouterOutputs["collections"]["get"];
export type CollectionItem = RouterOutputs["collections"]["items"][number];
export type CollectionStats = RouterOutputs["collections"]["stats"];
export type ArtworkState = RouterOutputs["collections"]["artworkState"];
export type PinState = RouterOutputs["collections"]["pinState"];
export type PosterCandidate = RouterOutputs["collections"]["posterCandidates"][number];

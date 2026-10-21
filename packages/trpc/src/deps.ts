/**
 * What a tRPC router is built from.
 *
 * `Services` plus the job system. Jobs cannot be part of `Services` itself —
 * `packages/jobs` resolves `ServicesToken`, so `@rube/composition`
 * depending on it would be a cycle — and routers are the layer that needs
 * both, so the two are joined here rather than anywhere lower.
 */
import type { Services } from "@rube/composition";
import type { Jobs } from "@rube/jobs";

export interface TrpcDeps extends Services {
  jobs: Jobs;
}

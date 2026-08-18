/**
 * What a tRPC router is built from.
 *
 * `Services` plus the job system. Jobs cannot be part of `Services` itself —
 * `packages/jobs` resolves `ServicesToken`, so `@tinkerbell/composition`
 * depending on it would be a cycle — and routers are the layer that needs
 * both, so the two are joined here rather than anywhere lower.
 */
import type { Services } from "@tinkerbell/composition";
import type { Jobs } from "@tinkerbell/jobs";

export interface TrpcDeps extends Services {
  jobs: Jobs;
}

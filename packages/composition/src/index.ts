/**
 * The one place the object graph is described.
 *
 * Every entrypoint calls `buildContainer` — the admin server, the Sidequest
 * worker thread, and the tests. That is the structural fix for the bug
 * documented at the top of the old `packages/jobs/src/hooks.ts`: wiring used to
 * be a function (`registerCoreHooks`) that each entrypoint had to remember to
 * call, whose omission produced no error because every hook defaulted to a
 * no-op. Here, building the container *is* the wiring, and a registration
 * nobody provides fails to resolve.
 */
import { createContainer, type RootContainer } from "@tinkerbell/container";
import { registerCore, type CoreEnv } from "./core.module.ts";
import { registerDomains } from "./domains.module.ts";
import { registerServices } from "./services.ts";

export { registerCore, type CoreEnv } from "./core.module.ts";
export { registerDomains } from "./domains.module.ts";
export { registerServices, ServicesToken, type Services } from "./services.ts";

export type Env = CoreEnv;

/**
 * Extra registrations from packages that sit above this one — `packages/jobs`
 * is the only one today. They cannot be listed here without a dependency
 * cycle, so entrypoints hand them in.
 */
export type Module = (r: Parameters<Parameters<typeof createContainer>[0]>[0]) => void;

export function buildContainer(env: Env = {}, modules: Module[] = []): RootContainer {
  return createContainer(
    (r) => {
      registerCore(r, env);
      registerDomains(r);
      registerServices(r);
      for (const module of modules) module(r);
    },
    { name: "tinkerbell" },
  );
}

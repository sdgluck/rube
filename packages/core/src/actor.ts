/**
 * Who is doing the thing right now.
 *
 * The change log wants a source and a username on every row, and the places
 * that record — `setConfig`, `updateRule`, `updateJob` — are the last places
 * that could know. `setConfig` is called from a tRPC mutation, from a job
 * running in a worker thread, and from a bundle import, and its signature is
 * the same all three times.
 *
 * The alternative was threading an actor argument through every one of those
 * call sites, which is the thing the plan for this feature explicitly ruled
 * out: an optional argument that most callers omit produces a log whose
 * `source` column is right about the calls somebody remembered and wrong about
 * the rest, and there is no way to tell which is which afterwards.
 *
 * So it is ambient, and narrow: one string pair, set at exactly three
 * boundaries (a tRPC request, a job run, an import), read only by the recorder.
 * `AsyncLocalStorage` survives every `await` inside the callback, which a
 * module-level `let` would not — two concurrent requests would otherwise
 * attribute each other's writes.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface Actor {
  /** "ui" | "job:<name>" | "import" | "registry" | "restore" | "system". */
  source: string;
  /** The signed-in admin, when there is one. Empty otherwise. */
  username: string;
}

/**
 * What an unattributed write looks like.
 *
 * "system" rather than "ui": a write that reached the store outside a request
 * and outside a job is a migration, a seed or a boot-time repair, and calling
 * that "ui" would be a lie that reads as a user action in the history.
 */
export const SYSTEM_ACTOR: Actor = { source: "system", username: "" };

const storage = new AsyncLocalStorage<Actor>();

/** Run `fn` with everything it does — including after an `await` — attributed. */
export function runAsActor<T>(actor: Actor, fn: () => T): T {
  return storage.run(actor, fn);
}

/** The current actor, or `SYSTEM_ACTOR` outside any of the three boundaries. */
export function currentActor(): Actor {
  return storage.getStore() ?? SYSTEM_ACTOR;
}

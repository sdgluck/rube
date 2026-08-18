/**
 * One instance per dependency set.
 *
 * A sub-factory called from two places — `createInternalJobs` from both the
 * runner and the jobs barrel — otherwise builds two independent instances, and
 * anything either of them holds (a registry, a latch, a cache) silently
 * diverges. Inside the container that never happens, because a token resolves
 * once; this gives the same guarantee to the plain factory calls that compose
 * a package internally.
 *
 * Keyed on the deps object by identity, in a `WeakMap`, so a container's
 * services keep exactly one instance and a test container's keep their own.
 */
export function perDeps<D extends object, T>(factory: (deps: D) => T): (deps: D) => T {
  const cache = new WeakMap<D, T>();
  return (deps: D): T => {
    const hit = cache.get(deps);
    if (hit !== undefined) return hit;
    const made = factory(deps);
    cache.set(deps, made);
    return made;
  };
}

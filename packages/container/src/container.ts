/**
 * The container kernel.
 *
 * Three lifetimes, one resolution path stack, and disposal that actually runs.
 * Everything else — what a `Db` is, where config comes from — lives in
 * `@tinkerbell/ports` and `@tinkerbell/composition`. This file knows nothing
 * about Tinkerbell and has no dependencies.
 */

import type { AnyToken, Token } from "./token.ts";
import {
  CircularDependencyError,
  ContainerError,
  DisposedScopeError,
  ScopeRequiredError,
  UnregisteredTokenError,
} from "./errors.ts";

/**
 * - `singleton` — one per process, cached on the root, disposed at shutdown.
 * - `scoped` — one per scope (a tRPC request, a job run), disposed with it.
 *   Deliberately unresolvable from the root; see `ScopeRequiredError`.
 * - `transient` — a fresh value every resolve, disposed with the scope that
 *   asked for it.
 */
export type Lifetime = "singleton" | "scoped" | "transient";

/**
 * What a factory is handed. Narrower than `Scope` on purpose: a factory may
 * resolve its own dependencies, but has no business creating or disposing
 * scopes.
 *
 * `owner` is the escape hatch for the rare value that legitimately needs the
 * scope itself — something that later derives a child context and must hand it
 * the scope it belongs to. For a singleton it is the root, because that is
 * where singletons are built.
 */
export interface Resolver {
  resolve<T>(token: Token<T>): T;
  readonly owner: Scope;
}

export interface Scope extends Resolver {
  readonly name: string;
  createScope(name: string): Scope;
  dispose(): Promise<void>;
}

export interface RegisterOptions<T> {
  lifetime?: Lifetime;
  /**
   * Run when the owning scope is disposed. This is how the SQLite handle gets
   * closed and how a per-request abort controller stops leaking — a container
   * that only constructs things is half a container.
   */
  dispose?: (value: T) => void | Promise<void>;
}

export interface Registry {
  register<T>(token: Token<T>, factory: (c: Resolver) => T, opts?: RegisterOptions<T>): void;
  /** Sugar for a pre-built singleton with no factory and no disposer. */
  value<T>(token: Token<T>, value: T): void;
  /**
   * Register over an existing registration instead of refusing it.
   *
   * The one legitimate use is a test that wants the real graph with two things
   * swapped for fakes — building a parallel wiring by hand instead would mean
   * the test no longer exercises the wiring it ships with. Production
   * composition uses `register`, which still refuses duplicates, so an
   * accidental double-registration is an error rather than a silent
   * last-one-wins.
   */
  replace<T>(token: Token<T>, factory: (c: Resolver) => T, opts?: RegisterOptions<T>): void;
}

export interface RootContainer extends Scope {
  /** Every registered token. The resolve-all test in `@tinkerbell/composition`
   * walks this, which is what turns a missing wiring edge into a red build
   * instead of a silent no-op at runtime. */
  tokens(): readonly AnyToken[];
  lifetimeOf(token: AnyToken): Lifetime | undefined;
}

interface Registration {
  token: AnyToken;
  factory: (c: Resolver) => unknown;
  lifetime: Lifetime;
  dispose?: (value: never) => void | Promise<void>;
}

type Disposer = () => void | Promise<void>;

/** Shared by the root and every scope beneath it, so a cycle that crosses a
 * scope boundary is still one path. */
interface ResolutionState {
  readonly registrations: Map<symbol, Registration>;
  readonly singletons: Map<symbol, unknown>;
  readonly stack: string[];
  readonly active: Set<symbol>;
  root: ScopeImpl;
}

class ScopeImpl implements Scope {
  readonly name: string;
  readonly #state: ResolutionState;
  readonly #isRoot: boolean;
  readonly #cache = new Map<symbol, unknown>();
  readonly #disposers: Disposer[] = [];
  readonly #children = new Set<ScopeImpl>();
  readonly #parent: ScopeImpl | undefined;
  #disposed = false;

  constructor(name: string, state: ResolutionState, parent: ScopeImpl | undefined) {
    this.name = name;
    this.#state = state;
    this.#parent = parent;
    this.#isRoot = parent === undefined;
  }

  get owner(): Scope {
    return this;
  }

  resolve<T>(token: Token<T>): T {
    if (this.#disposed) throw new DisposedScopeError(this.name, [...this.#state.stack]);

    const reg = this.#state.registrations.get(token.key);
    if (!reg) throw new UnregisteredTokenError(token.description, [...this.#state.stack]);

    switch (reg.lifetime) {
      case "singleton": {
        const cached = this.#state.singletons;
        if (cached.has(token.key)) return cached.get(token.key) as T;
        // Built against the *root*, never this scope. A singleton that resolved
        // a scoped token would capture the first scope's value for the life of
        // the process — the captive-dependency bug — and building it here is
        // what would let that happen silently.
        const value = this.#construct(reg, this.#state.root) as T;
        cached.set(token.key, value);
        this.#state.root.#addDisposer(reg, value);
        return value;
      }
      case "scoped": {
        if (this.#isRoot) throw new ScopeRequiredError(token.description, [...this.#state.stack]);
        if (this.#cache.has(token.key)) return this.#cache.get(token.key) as T;
        const value = this.#construct(reg, this) as T;
        this.#cache.set(token.key, value);
        this.#addDisposer(reg, value);
        return value;
      }
      case "transient": {
        const value = this.#construct(reg, this) as T;
        this.#addDisposer(reg, value);
        return value;
      }
    }
  }

  createScope(name: string): Scope {
    if (this.#disposed) throw new DisposedScopeError(this.name, []);
    const child = new ScopeImpl(name, this.#state, this);
    this.#children.add(child);
    return child;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    // Children first: a request scope holding a handle onto something the root
    // owns must let go before the root closes it.
    for (const child of [...this.#children].reverse()) await child.dispose();
    this.#children.clear();

    // LIFO — the reverse of construction order, which is the only order in
    // which a disposer can still assume the things it was built from exist.
    for (let i = this.#disposers.length - 1; i >= 0; i--) {
      await this.#disposers[i]!();
    }
    this.#disposers.length = 0;
    this.#cache.clear();
    if (this.#isRoot) this.#state.singletons.clear();
    if (this.#parent) this.#parent.#children.delete(this);
  }

  #construct(reg: Registration, resolver: ScopeImpl): unknown {
    const key = reg.token.key;
    if (this.#state.active.has(key)) {
      throw new CircularDependencyError(reg.token.description, [...this.#state.stack, reg.token.description]);
    }
    this.#state.active.add(key);
    this.#state.stack.push(reg.token.description);
    try {
      return reg.factory(resolver);
    } finally {
      this.#state.stack.pop();
      this.#state.active.delete(key);
    }
  }

  #addDisposer(reg: Registration, value: unknown): void {
    const dispose = reg.dispose;
    if (!dispose) return;
    this.#disposers.push(() => (dispose as (v: unknown) => void | Promise<void>)(value));
  }
}

class RootImpl extends ScopeImpl implements RootContainer {
  readonly #state: ResolutionState;

  constructor(name: string, state: ResolutionState) {
    super(name, state, undefined);
    this.#state = state;
  }

  tokens(): readonly AnyToken[] {
    return [...this.#state.registrations.values()].map((r) => r.token);
  }

  lifetimeOf(token: AnyToken): Lifetime | undefined {
    return this.#state.registrations.get(token.key)?.lifetime;
  }
}

/**
 * Build a container.
 *
 * Registration happens once, inside `configure`, and the registry is sealed
 * afterwards. Late registration is how a container turns back into the mutable
 * global it was meant to replace — the exact shape of `setHealthReporter`,
 * where anything could reassign the graph at any point and a missed call was
 * indistinguishable from a working one.
 */
export function createContainer(configure: (registry: Registry) => void, opts: { name?: string } = {}): RootContainer {
  const registrations = new Map<symbol, Registration>();
  let sealed = false;

  const put = (token: AnyToken, factory: unknown, options: RegisterOptions<never>) => {
    if (sealed) {
      throw new ContainerError(`Cannot register "${token.description}" after the container is built.`, []);
    }
    registrations.set(token.key, {
      token,
      factory: factory as (c: Resolver) => unknown,
      lifetime: options.lifetime ?? "singleton",
      dispose: options.dispose as Registration["dispose"],
    });
  };

  const registry: Registry = {
    register(token, factory, options = {}) {
      if (registrations.has(token.key)) {
        throw new ContainerError(`"${token.description}" is already registered.`, []);
      }
      put(token, factory, options as RegisterOptions<never>);
    },
    replace(token, factory, options = {}) {
      put(token, factory, options as RegisterOptions<never>);
    },
    value(token, value) {
      registry.register(token, () => value);
    },
  };

  configure(registry);
  sealed = true;

  const state: ResolutionState = {
    registrations,
    singletons: new Map(),
    stack: [],
    active: new Set(),
    // Assigned immediately below — the root has to exist before it can name
    // itself, and every other field is already final by then.
    root: undefined as unknown as ScopeImpl,
  };
  const root = new RootImpl(opts.name ?? "root", state);
  state.root = root;
  return root;
}

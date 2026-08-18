/**
 * A typed key into the container.
 *
 * The type parameter is carried by a phantom property that never exists at
 * runtime, so `resolve(DbToken)` comes back as `Database` with no cast and no
 * `Cradle` interface to keep in step by hand. This is the whole reason the
 * container is hand-rolled rather than awilix: name-keyed resolution would put
 * a `string` between every consumer and the thing it depends on, in a codebase
 * that is otherwise strict end to end.
 *
 * The phantom is a function type rather than a bare `T` deliberately — a bare
 * `T` makes `Token<T>` covariant, so a `Token<Dog>` would satisfy a parameter
 * asking for `Token<Animal>` and the registration for one could answer a
 * resolve for the other. As a function of `T` it is invariant, and the two are
 * unrelated types.
 */
declare const PHANTOM: unique symbol;

/**
 * A token with its type erased.
 *
 * Not `Token<unknown>`: the phantom makes `Token<T>` invariant, so `Token<Db>`
 * is deliberately *not* a `Token<unknown>`. Code that only needs identity —
 * enumerating registrations, looking up a lifetime — asks for this instead.
 */
export interface AnyToken {
  /** Identity. Two tokens with the same description are still distinct keys. */
  readonly key: symbol;
  /** Human-readable, and the only thing that appears in resolution paths. */
  readonly description: string;
}

export interface Token<T> extends AnyToken {
  readonly [PHANTOM]?: (value: T) => T;
}

export function token<T>(description: string): Token<T> {
  return { key: Symbol(description), description };
}

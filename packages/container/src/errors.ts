/**
 * Every failure the container can produce, named.
 *
 * All of them carry the resolution path that led there. A DI error with no path
 * is close to useless — "cannot resolve config" tells you nothing about which
 * of the forty things that depend on config asked for it.
 */
export class ContainerError extends Error {
  readonly path: readonly string[];

  constructor(message: string, path: readonly string[]) {
    super(path.length > 0 ? `${message}\n  while resolving: ${path.join(" → ")}` : message);
    this.name = "ContainerError";
    this.path = path;
  }
}

export class UnregisteredTokenError extends ContainerError {
  constructor(description: string, path: readonly string[]) {
    super(`No registration for "${description}".`, path);
    this.name = "UnregisteredTokenError";
  }
}

export class CircularDependencyError extends ContainerError {
  constructor(description: string, path: readonly string[]) {
    super(`Circular dependency: "${description}" depends on itself.`, path);
    this.name = "CircularDependencyError";
  }
}

/**
 * A scoped token asked for from the root.
 *
 * Rejected rather than quietly cached on the root, because caching it is the
 * captive-dependency bug: a per-request client would be created once at boot
 * and every later request would silently share the first one's credentials.
 */
export class ScopeRequiredError extends ContainerError {
  constructor(description: string, path: readonly string[]) {
    super(`"${description}" is scoped and cannot be resolved from the root container — create a scope first.`, path);
    this.name = "ScopeRequiredError";
  }
}

export class DisposedScopeError extends ContainerError {
  constructor(scopeName: string, path: readonly string[]) {
    super(`Scope "${scopeName}" has been disposed and can no longer resolve.`, path);
    this.name = "DisposedScopeError";
  }
}

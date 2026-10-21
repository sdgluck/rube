/**
 * The kernel's contract, stated as tests.
 *
 * Three of these exist because of specific bugs the module-singleton design
 * kept producing and this container is meant to make impossible: a dependency
 * that silently resolves to the wrong instance (captive dependency), a wiring
 * edge that is missing but throws nothing, and a handle nobody ever closes.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createContainer, token, type Registry } from "./index.ts";
import { CircularDependencyError, DisposedScopeError, ScopeRequiredError, UnregisteredTokenError } from "./errors.ts";

interface Db {
  readonly id: string;
}
const DbToken = token<Db>("db");
const RequestIdToken = token<string>("requestId");
const CounterToken = token<{ n: number }>("counter");

describe("lifetimes", () => {
  test("a singleton is built once and shared across scopes", () => {
    let built = 0;
    const root = createContainer((r) => {
      r.register(DbToken, () => ({ id: `db-${++built}` }));
    });

    const a = root.createScope("a");
    const b = root.createScope("b");
    assert.equal(root.resolve(DbToken), a.resolve(DbToken));
    assert.equal(a.resolve(DbToken), b.resolve(DbToken));
    assert.equal(built, 1);
  });

  test("a scoped value is one per scope and different between scopes", () => {
    const root = createContainer((r) => {
      r.register(RequestIdToken, () => `req-${Math.random()}`, { lifetime: "scoped" });
    });

    const a = root.createScope("a");
    const b = root.createScope("b");
    assert.equal(a.resolve(RequestIdToken), a.resolve(RequestIdToken));
    assert.notEqual(a.resolve(RequestIdToken), b.resolve(RequestIdToken));
  });

  test("a transient is rebuilt on every resolve, even within one scope", () => {
    let built = 0;
    const root = createContainer((r) => {
      r.register(CounterToken, () => ({ n: ++built }), { lifetime: "transient" });
    });

    const scope = root.createScope("s");
    assert.equal(scope.resolve(CounterToken).n, 1);
    assert.equal(scope.resolve(CounterToken).n, 2);
  });
});

describe("captive dependencies", () => {
  test("a scoped token cannot be resolved from the root", () => {
    const root = createContainer((r) => {
      r.register(RequestIdToken, () => "req-1", { lifetime: "scoped" });
    });

    assert.throws(() => root.resolve(RequestIdToken), ScopeRequiredError);
  });

  /**
   * The bug this rules out: a process-lifetime service reaching for a
   * per-request value would pin the *first* request's value forever, and every
   * later request would silently read someone else's. Rejected at construction
   * rather than cached, so it surfaces the first time it is wired rather than
   * as a data leak in production.
   */
  test("a singleton that depends on a scoped token fails loudly", () => {
    const ServiceToken = token<{ id: string }>("service");
    const root = createContainer((r) => {
      r.register(RequestIdToken, () => "req-1", { lifetime: "scoped" });
      r.register(ServiceToken, (c) => ({ id: c.resolve(RequestIdToken) }));
    });

    assert.throws(() => root.createScope("a").resolve(ServiceToken), ScopeRequiredError);
  });
});

describe("errors", () => {
  test("an unregistered token names itself", () => {
    const root = createContainer(() => {});
    assert.throws(
      () => root.resolve(DbToken),
      (err: unknown) => {
        assert.ok(err instanceof UnregisteredTokenError);
        assert.match(err.message, /No registration for "db"/);
        return true;
      },
    );
  });

  test("a cycle reports the full path rather than overflowing the stack", () => {
    const a = token<string>("a");
    const b = token<string>("b");
    const root = createContainer((r) => {
      r.register(a, (c) => `a:${c.resolve(b)}`);
      r.register(b, (c) => `b:${c.resolve(a)}`);
    });

    assert.throws(
      () => root.resolve(a),
      (err: unknown) => {
        assert.ok(err instanceof CircularDependencyError);
        assert.match(err.message, /a → b → a/);
        return true;
      },
    );
  });

  test("the resolution path is reported for a failure deep in the graph", () => {
    const missing = token<string>("missing");
    const mid = token<string>("mid");
    const top = token<string>("top");
    const root = createContainer((r) => {
      r.register(mid, (c) => c.resolve(missing));
      r.register(top, (c) => c.resolve(mid));
    });

    assert.throws(
      () => root.resolve(top),
      (err: unknown) => {
        assert.ok(err instanceof UnregisteredTokenError);
        assert.match(err.message, /while resolving: top → mid/);
        return true;
      },
    );
  });

  test("registering the same token twice is refused", () => {
    assert.throws(() =>
      createContainer((r) => {
        r.register(DbToken, () => ({ id: "1" }));
        r.register(DbToken, () => ({ id: "2" }));
      }),
    );
  });

  /**
   * The registry is sealed once the container is built. Late registration is
   * how a container decays back into the mutable global it replaced — it is
   * exactly the shape of `setHealthReporter`, where any module could reassign
   * the graph at any point and a missed call looked identical to a made one.
   */
  test("registering after the container is built is refused", () => {
    let escaped: Registry | undefined;
    const root = createContainer((r) => {
      escaped = r;
      r.register(DbToken, () => ({ id: "1" }));
    });

    assert.ok(root);
    assert.throws(() => escaped!.register(RequestIdToken, () => "late"), /after the container is built/);
  });
});

describe("disposal", () => {
  test("disposers run LIFO and only once", async () => {
    const order: string[] = [];
    const first = token<string>("first");
    const second = token<string>("second");
    const root = createContainer((r) => {
      r.register(first, () => "first", { dispose: () => void order.push("first") });
      r.register(second, (c) => `${c.resolve(first)}/second`, { dispose: () => void order.push("second") });
    });

    root.resolve(second);
    await root.dispose();
    await root.dispose();
    assert.deepEqual(order, ["second", "first"]);
  });

  test("disposing a scope releases its values but leaves the root intact", async () => {
    const disposed: string[] = [];
    const root = createContainer((r) => {
      r.register(DbToken, () => ({ id: "db" }), { dispose: () => void disposed.push("db") });
      r.register(RequestIdToken, () => "req", {
        lifetime: "scoped",
        dispose: () => void disposed.push("req"),
      });
    });

    const scope = root.createScope("request");
    scope.resolve(RequestIdToken);
    await scope.dispose();

    assert.deepEqual(disposed, ["req"]);
    assert.equal(root.resolve(DbToken).id, "db");
    assert.throws(() => scope.resolve(DbToken), DisposedScopeError);
  });

  test("disposing the root cascades into live scopes first", async () => {
    const order: string[] = [];
    const root = createContainer((r) => {
      r.register(DbToken, () => ({ id: "db" }), { dispose: () => void order.push("db") });
      r.register(RequestIdToken, () => "req", {
        lifetime: "scoped",
        dispose: () => void order.push("req"),
      });
    });

    root.createScope("request").resolve(RequestIdToken);
    root.resolve(DbToken);
    await root.dispose();

    // The request-scoped value goes before the connection it was reading from.
    assert.deepEqual(order, ["req", "db"]);
  });

  test("a transient is disposed with the scope that asked for it", async () => {
    const order: string[] = [];
    const root = createContainer((r) => {
      r.register(CounterToken, () => ({ n: 1 }), {
        lifetime: "transient",
        dispose: () => void order.push("counter"),
      });
    });

    const scope = root.createScope("s");
    scope.resolve(CounterToken);
    scope.resolve(CounterToken);
    await scope.dispose();
    assert.deepEqual(order, ["counter", "counter"]);
  });
});

describe("introspection", () => {
  /**
   * What `@rube/composition`'s resolve-all test is built on. The whole
   * point of the overhaul is that a missing edge fails a build instead of
   * defaulting to a no-op, and that requires the graph to be enumerable.
   */
  test("every registration is enumerable with its lifetime", () => {
    const root = createContainer((r) => {
      r.register(DbToken, () => ({ id: "db" }));
      r.register(RequestIdToken, () => "req", { lifetime: "scoped" });
    });

    assert.deepEqual(
      root
        .tokens()
        .map((t) => t.description)
        .sort(),
      ["db", "requestId"],
    );
    assert.equal(root.lifetimeOf(DbToken), "singleton");
    assert.equal(root.lifetimeOf(RequestIdToken), "scoped");
    assert.equal(root.lifetimeOf(CounterToken), undefined);
  });
});

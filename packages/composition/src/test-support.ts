/**
 * A container for tests: the real graph, on a throwaway database, with fakes
 * for whatever the test wants to control.
 *
 * The shape a test takes now:
 *
 *     const c = createTestContainer();
 *     after(c.dispose);
 *     const config = c.resolve(ConfigStoreToken);
 *
 * versus what it replaces — mkdtemp a directory, mutate `process.env.DATA_DIR`,
 * spawn the migrator as a subprocess, then `await import()` the subject in a
 * hand-maintained order so nothing touched `@tinkerbell/db` too early.
 *
 * `overrides` uses `registry.replace`, so the test still exercises the real
 * wiring with specific edges swapped, rather than a parallel graph assembled by
 * hand that can drift from the one that ships.
 */
import { createContainer, type Registry, type RootContainer } from "@tinkerbell/container";
import { DbToken } from "@tinkerbell/db";
import { createTestDb } from "@tinkerbell/db/test-db";
import { ClockToken, HealthReporterToken, type HealthStatus } from "@tinkerbell/ports";
import { registerCore } from "./core.module.ts";
import { registerDomains } from "./domains.module.ts";
import { registerServices } from "./services.ts";

export interface TestContainerOptions {
  /** Applied after the real registrations, so they win. */
  overrides?: (r: Registry) => void;
  /** Fixed `now()`, for anything that reads the clock. */
  now?: number;
}

export interface TestContainer extends RootContainer {
  /** Everything the fake health reporter was told, in order. */
  healthEvents: { service: string; status: HealthStatus; message: string }[];
  /**
   * Move the fixed clock. Only meaningful when `now` was passed — without it
   * the container holds the real clock and these throw, rather than silently
   * doing nothing to a test that thought it had control of time.
   */
  setNow(ms: number): void;
  advance(ms: number): void;
  dispose(): Promise<void>;
}

export function createTestContainer(opts: TestContainerOptions = {}): TestContainer {
  const testDb = createTestDb();
  const healthEvents: TestContainer["healthEvents"] = [];
  let clock = opts.now ?? 0;

  const root = createContainer(
    (r) => {
      registerCore(r, { dataDir: testDb.dataDir, startedAt: opts.now });
      registerDomains(r);
      registerServices(r);

      // The database is already open and migrated, so hand it over rather than
      // letting `registerCore` open a second connection to the same file.
      r.replace(DbToken, () => testDb.db);

      // Health is provided by `domains/health` in the real graph. A test that
      // cares registers its own; this one records, so an assertion can be made
      // about what was reported rather than it vanishing into a no-op.
      r.replace(HealthReporterToken, () => (service: string, status: HealthStatus, message: string) => {
        healthEvents.push({ service, status, message });
      });

      // A fixed clock, and a handle to move it. `now` seeds it; `setNow` and
      // `advance` on the returned container are what a retention or grace-period
      // test uses instead of writing rows into the past.
      if (opts.now !== undefined) {
        r.replace(ClockToken, () => () => clock);
      }

      opts.overrides?.(r);
    },
    { name: "test" },
  );

  const dispose = root.dispose.bind(root);
  const requireFixedClock = () => {
    if (opts.now === undefined) {
      throw new Error("createTestContainer: pass `now` to control the clock.");
    }
  };
  return Object.assign(root, {
    healthEvents,
    setNow(ms: number) {
      requireFixedClock();
      clock = ms;
    },
    advance(ms: number) {
      requireFixedClock();
      clock += ms;
    },
    async dispose() {
      await dispose();
      testDb.dispose();
    },
  });
}

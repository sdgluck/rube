import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { join } from "node:path";
import * as schema from "./schema.ts";

const DB_PATH = join(process.env.DATA_DIR || join(import.meta.dirname, "..", "..", ".."), "tinkerbell.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("temp_store = MEMORY");
sqlite.pragma("cache_size = -65536"); // 64 MiB page cache
sqlite.pragma("mmap_size = 268435456"); // 256 MiB
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

export * from "./schema.ts";

// Migrations are NOT applied here. They run as a discrete entrypoint step
// (dev script, Docker entrypoint) via `pnpm --filter @tinkerbell/db migrate`.
// Application code assumes the schema is already migrated by the time it
// runs a query — see packages/db/src/migrate.ts for the migrator CLI.

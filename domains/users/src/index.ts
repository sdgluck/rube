/**
 * Users module — sync Plex users to local SQLite, query them, and manage
 * their access to the server.
 *
 * `sync.ts` counts `User:<name>` collection labels, which belong to
 * `domains/collections` — a domain that sits *above* this one. That edge used
 * to be `setLocalCollectionsReader`, a module-level `let` in core defaulting to
 * `() => ({ items: [] })`, so an unwired process saw every user as having no
 * personal collections and said so in the UI. It is now the injected
 * `CollectionsReader` port: unprovided means unresolvable, not silently empty.
 */
import { token } from "@rube/container";
import type { Db } from "@rube/db";
import type { ConfigStore } from "@rube/core";
import type { CollectionsReader } from "@rube/ports";
import { createSync } from "./sync.ts";
import { createQuery } from "./query.ts";
import { createDetail } from "./detail.ts";
import { createManage } from "./manage.ts";

export { type SyncStats } from "./sync.ts";
export { type LocalUser, type UserFilters } from "./query.ts";
export { type UserDetail, type UserShareState } from "./detail.ts";
export {
  inviteUser,
  createManagedUser,
  addExistingUserToHome,
  OwnerImmutableError,
  UnknownUserError,
  NotSharedError,
  type InviteInput,
} from "./manage.ts";

export interface UsersDeps {
  db: Db;
  config: ConfigStore;
  readLocalCollections: CollectionsReader;
}

export function createUsers(deps: UsersDeps) {
  return {
    ...createSync(deps),
    ...createQuery(deps),
    ...createDetail(deps),
    ...createManage(deps),
  };
}

export type Users = ReturnType<typeof createUsers>;

export const UsersToken = token<Users>("users");

/**
 * What the settings form's user pickers offer.
 *
 * Users come from the local `plex_users` cache only — no live Plex call — so an
 * empty list means "sync users", which the form says.
 */
import { asc } from "drizzle-orm";
import { type Services } from "@tinkerbell/composition";
import { plexUsers } from "@tinkerbell/db";

export type FieldOptions = {
  users: { username: string; label: string; optedIn: boolean }[];
};

export function createFieldOptions(deps: Pick<Services, "db" | "preferences">) {
  const { db, preferences } = deps;

  function fieldOptions(): FieldOptions {
    const optedIn = new Set(preferences.listOptedInUserPreferences().map((u) => u.userId));
    const users = db
      .select({ userId: plexUsers.userId, username: plexUsers.username, name: plexUsers.name })
      .from(plexUsers)
      .orderBy(asc(plexUsers.username))
      .all()
      .map((u) => ({
        username: u.username,
        label: u.name && u.name !== u.username ? `${u.name} (${u.username})` : u.username,
        optedIn: optedIn.has(u.userId),
      }));
    return { users };
  }

  return { fieldOptions };
}

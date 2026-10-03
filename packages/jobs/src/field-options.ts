/**
 * What the settings form's user and rule pickers offer.
 *
 * Served from here rather than assembled in the browser from `users.list` and
 * `rules.list`: "which rules can Personalized Collections target" is the same
 * filter the command applies (enabled and personalizable), and it should live
 * beside the command, not be re-derived by a page.
 *
 * Users come from the local `plex_users` cache only — no live Plex call — so an
 * empty list means "sync users", which the form says.
 */
import { asc } from "drizzle-orm";
import { type Services } from "@tinkerbell/composition";
import { plexUsers } from "@tinkerbell/db";
import { parseRuleConfig } from "./commands/generate/config.ts";

export type FieldOptions = {
  users: { username: string; label: string; optedIn: boolean }[];
  rules: { id: string; name: string }[];
};

export function createFieldOptions(deps: Pick<Services, "db" | "preferences" | "rules">) {
  const { db, preferences, rules } = deps;

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
    const personalizable = rules
      .getEnabledRules()
      .filter((r) => parseRuleConfig(r).personalizable)
      .map((r) => ({ id: r.id, name: r.name }));
    return { users, rules: personalizable };
  }

  return { fieldOptions };
}

/**
 * Whose films someone keeps finishing: the directors and leading actors in
 * what they've watched, scored. Apart from the command so the scoring is
 * testable without TMDb.
 */
import { DAY_MS } from "@rube/core";
import type { TmdbCachedDetails } from "@rube/db";

/** Billed this high or higher counts as a lead. A cameo in the fourteenth slot says nothing about taste. */
export const LEAD_BILLING = 3;
/** A film watched a year ago counts half as much as one watched today, on top of the one it always counts. */
const RECENCY_HALF_LIFE_DAYS = 365;

export interface Person {
  id: number;
  name: string;
  role: "director" | "actor";
  /** TMDb ids of their films this person finished. */
  seen: Set<number>;
  score: number;
}

/**
 * Score every director and lead actor across the films someone finished.
 * Each film counts one, plus up to one more for how recently it was watched,
 * so a person whose films they watched this year outranks one from a decade
 * ago with the same count. Someone who directed and starred is a director:
 * their row is "films they directed", the list a person can name.
 */
export function scorePeople(
  finished: Array<{ tmdbId: number; lastPlayedAt: number }>,
  details: ReadonlyMap<number, TmdbCachedDetails>,
  now: number,
  opts: { includeActors: boolean },
): Person[] {
  const people = new Map<number, Person>();
  const credit = (id: number, name: string, role: Person["role"], film: number, weight: number) => {
    const p = people.get(id) ?? { id, name, role, seen: new Set<number>(), score: 0 };
    if (role === "director") p.role = "director";
    if (!p.seen.has(film)) {
      p.seen.add(film);
      p.score += weight;
    }
    people.set(id, p);
  };
  for (const film of finished) {
    const d = details.get(film.tmdbId);
    if (!d) continue;
    const ageDays = Math.max(0, now - film.lastPlayedAt) / DAY_MS;
    const weight = 1 + 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
    for (const director of d.directors ?? []) credit(director.id, director.name, "director", film.tmdbId, weight);
    if (opts.includeActors) {
      for (const actor of d.cast ?? []) {
        if ((actor.order ?? Infinity) < LEAD_BILLING) credit(actor.id, actor.name, "actor", film.tmdbId, weight);
      }
    }
  }
  return [...people.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** "Denis Villeneuve: you've seen 3 of the films they directed. Here are the rest." */
export function moreFromSummary(person: Pick<Person, "name" | "role" | "seen">): string {
  const what = person.role === "director" ? "films they directed" : "films they star in";
  return `${person.name}: you've seen ${person.seen.size} of the ${what}. Here are the rest in the library.`;
}

/** The label that says whose row it is. */
export function personKey(id: number): string {
  return `Person:${id}`;
}

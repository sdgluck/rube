/**
 * Movie match — the portal's "what shall we watch?" rooms.
 *
 * A room is a movie library plus these filters. Both sides need the filter
 * shape: the server applies it to the deck and the portal describes it on the
 * room's header, so it lives here rather than in either.
 *
 * Every bound is optional and absent means "don't filter". A film the mirror
 * knows nothing about (no rating, no runtime) passes a bound on that field
 * rather than failing it — the same rule the digest uses, because "unknown"
 * is not evidence that someone wouldn't want to watch it.
 */
import { z } from "zod";

const year = z.number().int().min(1870).max(2200);

export const matchFiltersSchema = z.object({
  /** Any of these. */
  genres: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  /** Runtime ceiling, in minutes. */
  maxMinutes: z.number().int().min(1).max(1000).optional(),
  minYear: year.optional(),
  maxYear: year.optional(),
  /** 0–10, the mirror's critic-else-audience rating. */
  minRating: z.number().min(0).max(10).optional(),
  maxRating: z.number().min(0).max(10).optional(),
});

export type MatchFilters = z.infer<typeof matchFiltersSchema>;

/** Room codes: no 0/O or 1/I, so one read out across a room is unambiguous. */
export const MATCH_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MATCH_CODE_LENGTH = 4;

export const matchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${MATCH_CODE_ALPHABET}]{${MATCH_CODE_LENGTH}}$`), "That isn't a room code.");

/** The short pills a room's header shows for its filters. */
export function describeMatchFilters(filters: MatchFilters): string[] {
  const pills: string[] = [];
  const genres = filters.genres ?? [];
  if (genres.length > 0) {
    pills.push(genres.length <= 2 ? genres.join(", ") : `${genres.slice(0, 2).join(", ")} +${genres.length - 2}`);
  }
  if (filters.maxMinutes) {
    const h = Math.floor(filters.maxMinutes / 60);
    const m = filters.maxMinutes % 60;
    pills.push(`Under ${h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`}`);
  }
  if (filters.minYear && filters.maxYear) pills.push(`${filters.minYear}–${filters.maxYear}`);
  else if (filters.minYear) pills.push(`${filters.minYear} on`);
  else if (filters.maxYear) pills.push(`Before ${filters.maxYear + 1}`);
  if (filters.minRating !== undefined) pills.push(`Rated ${filters.minRating}+`);
  if (filters.maxRating !== undefined) pills.push(`Rated under ${filters.maxRating}`);
  return pills;
}

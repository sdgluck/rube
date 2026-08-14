import { LOCAL_FIELD_DEFS } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";

/**
 * Value control for `tb.watchedBy`.
 *
 * The stored value is a Plex account id. A free-text box would be a request to
 * type a number nobody knows, and unlike the tag fields there is no per-section
 * facet to resolve it against — the ids come from `plex_users`, so the picker
 * reads them straight from `users.list`.
 */
export default function UserValueSelect({
  value,
  className,
  disabled,
  onChange,
}: {
  value: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const query = trpc.users.list.useQuery(
    { offset: 0, limit: 200, sortDir: "asc" },
    { staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  );
  const users = query.data?.items ?? [];

  return (
    <select className={className} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {/* A stored id we can't resolve — a user removed from the server since
          the rule was written — stays selected rather than silently becoming
          somebody else. */}
      {!value && <option value="">Choose a user…</option>}
      {value && !users.some((u) => String(u.userId) === value) && <option value={value}>User {value}</option>}
      {users.map((u) => (
        <option key={u.userId} value={String(u.userId)}>
          {u.name || u.username}
        </option>
      ))}
    </select>
  );
}

/** Grouping label for the watch-history section of a field picker. */
export const LOCAL_FIELD_GROUP_LABEL = "Watch history";

/**
 * Why the group exists, said once above the picker.
 *
 * The distinction genuinely matters: Plex's own `Unplayed` answers for
 * whichever token asked, and Tinkerbell asks with the owner's. A user picking
 * between "Unplayed" and "Watched by nobody" needs to know they are not the
 * same question.
 */
export const LOCAL_FIELD_GROUP_NOTE =
  "These use Tinkerbell's own playback history across every user, not Plex's — Plex only ever reports the server owner's view state.";

export const LOCAL_FIELD_HINTS: ReadonlyMap<string, string> = new Map(
  LOCAL_FIELD_DEFS.map((d) => [d.field, d.hint ?? ""]),
);

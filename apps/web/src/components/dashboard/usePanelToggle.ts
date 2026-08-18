import { useEffect, useMemo, useState } from "react";

/**
 * A persisted set of panel ids — which panels are hidden, which are rolled up.
 *
 * Held as local state and written through on every change rather than waiting
 * on the save to land: both of the things this stores are toggles the user
 * flips while looking at the result, and a round trip's worth of delay before
 * a panel disappears reads as a click that didn't register.
 *
 * Unknown ids are dropped on read, so a panel we've since removed can't sit in
 * a stale config keeping a slot warm — and, for the hidden set, so it can't
 * hide a panel that has since taken its name.
 */
export function usePanelToggle<Id extends string>({
  ids,
  saved,
  onSave,
}: {
  ids: readonly Id[];
  saved: string[] | undefined;
  onSave: (next: Id[]) => void;
}): {
  has: (id: Id) => boolean;
  toggle: (id: Id) => void;
  replace: (next: Id[]) => void;
} {
  const resolved = useMemo<Id[]>(() => {
    const known = new Set<string>(ids);
    return [...new Set(saved ?? [])].filter((id): id is Id => known.has(id));
  }, [saved?.join(","), ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [current, setCurrent] = useState<Id[]>(resolved);
  useEffect(() => setCurrent(resolved), [resolved]);

  const commit = (next: Id[]) => {
    setCurrent(next);
    onSave(next);
  };

  return {
    has: (id) => current.includes(id),
    toggle: (id) => commit(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]),
    replace: commit,
  };
}

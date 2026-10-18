import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "#/trpc";
import {
  NAV_SECTIONS,
  UNHIDEABLE,
  applyNavPrefs,
  defaultItemOrder,
  defaultSectionOrder,
  mergeOrder,
  resolveNav,
  visibleSections,
  type NavPrefs,
  type NavSection,
} from "#/nav";

/**
 * The menu layout, shared by everything that draws or edits a menu.
 *
 * A context rather than a query in the sidebar because the sidebar and its
 * editor have to agree *while being edited*, and the editor's draft has to
 * outlive the sidebar re-rendering around it. The edit flag lives here for the
 * same reason.
 */

/**
 * A copy of the saved layout, kept in the browser and read before the config
 * query lands.
 *
 * Without it every cold load paints the default menu and then re-shuffles into
 * the customised one a round trip later — the same flicker `visibleSections`'
 * comment exists to prevent, just moved from setup status to layout. `ui_theme`
 * already does exactly this for the pre-paint problem. The server always wins
 * the moment it answers; this is a guess at what it will say, not a cache.
 */
const MIRROR_KEY = "tinkerbell.nav-prefs";

function readMirror(): NavPrefs {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const p = parsed as Record<string, unknown>;
    const arr = (v: unknown) =>
      Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
    return {
      hidden: arr(p.hidden),
      itemOrder: arr(p.itemOrder),
      sectionOrder: arr(p.sectionOrder),
    };
  } catch {
    // A private window, cleared site data, or a browser refusing storage. The
    // default menu is the right answer in all three.
    return {};
  }
}

function writeMirror(prefs: NavPrefs): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked. Costs a flicker on the next cold load, nothing more.
  }
}

export type NavMenu = {
  /** The menu as it should render right now. */
  sections: NavSection[];
  /** The full catalogue in current order, hidden items included — what the editor lists. */
  editableSections: NavSection[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  isHidden: (to: string) => boolean;
  canHide: (to: string) => boolean;
  toggleHidden: (to: string) => void;
  moveItem: (sectionId: string, from: number, to: number) => void;
  moveSection: (from: number, to: number) => void;
  reset: () => void;
  isDefault: boolean;
};

const NavMenuContext = createContext<NavMenu | null>(null);

/** How long a burst of drags is allowed to run before it becomes one write. */
const ORDER_WRITE_DELAY_MS = 600;

export function NavMenuProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  // The same options `useThemeConfigSync` uses, so this shares that cache entry
  // rather than issuing a second request for the same blob.
  const configQuery = trpc.config.get.useQuery(undefined, { staleTime: Infinity });
  const setupQuery = trpc.onboarding.status.useQuery(undefined, { retry: false });
  const saveMutation = trpc.config.save.useMutation({
    onSuccess: () => utils.config.get.invalidate(),
  });

  const [editing, setEditing] = useState(false);
  const [mirror] = useState<NavPrefs>(() => readMirror());

  const server: NavPrefs | undefined = configQuery.data
    ? {
        hidden: configQuery.data.nav_items_hidden,
        itemOrder: configQuery.data.nav_item_order,
        sectionOrder: configQuery.data.nav_section_order,
      }
    : undefined;

  // Local state is the source of truth *while editing*: a drag has to land
  // instantly, and the order write behind it is debounced, so waiting for the
  // query to come back would make every drag snap back before taking effect.
  const [draft, setDraft] = useState<NavPrefs>(() => mirror);
  const dirty = useRef(false);
  useEffect(() => {
    if (!server || dirty.current) return;
    setDraft(server);
    writeMirror(server);
  }, [JSON.stringify(server)]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = useRef<NavPrefs | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    saveMutation.mutate({
      nav_items_hidden: next.hidden ?? [],
      nav_item_order: next.itemOrder ?? [],
      nav_section_order: next.sectionOrder ?? [],
    });
  }, [saveMutation]);

  /**
   * `immediate` is the difference between a decision and a gesture. Switching an
   * item off is one deliberate act and should land at once; a drag session emits
   * a position on every drop, and each one is a write to the same SQLite row.
   */
  const commit = useCallback(
    (next: NavPrefs, immediate: boolean) => {
      dirty.current = true;
      setDraft(next);
      writeMirror(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      if (immediate) {
        flush();
        return;
      }
      timer.current = setTimeout(flush, ORDER_WRITE_DELAY_MS);
    },
    [flush],
  );

  // Leaving edit mode, or leaving the app, must not lose the last drag.
  useEffect(() => {
    if (!editing) flush();
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setupComplete = setupQuery.data?.complete;

  // The editor's list: current order, but hidden items still in it — you cannot
  // switch something back on that isn't drawn. The setup filter still applies,
  // so a finished install isn't offered a row it will never see.
  const editableSections = useMemo(
    () => visibleSections(applyNavPrefs(NAV_SECTIONS, { ...draft, hidden: [] }), setupComplete),
    [JSON.stringify(draft), setupComplete], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sections = useMemo(
    () => resolveNav(NAV_SECTIONS, draft, setupComplete),
    [JSON.stringify(draft), setupComplete], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const hidden = useMemo(() => new Set(draft.hidden ?? []), [JSON.stringify(draft.hidden)]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: NavMenu = {
    sections,
    editableSections,
    editing,
    setEditing,
    isHidden: (to) => hidden.has(to),
    canHide: (to) => to !== UNHIDEABLE,
    toggleHidden: (to) => {
      if (to === UNHIDEABLE) return;
      const next = new Set(hidden);
      if (next.has(to)) next.delete(to);
      else next.add(to);
      commit({ ...draft, hidden: [...next] }, true);
    },
    moveItem: (sectionId, from, to) => {
      const section = editableSections.find((s) => s.id === sectionId);
      if (!section) return;
      const within = section.items.map((i) => i.to);
      if (from < 0 || to < 0 || from >= within.length || to >= within.length || from === to) return;
      const reordered = [...within];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      // Only this section's slice changes: the flat order is rebuilt from the
      // current order of every section so an item can never cross a boundary.
      const flat = editableSections.flatMap((s) => (s.id === sectionId ? reordered : s.items.map((i) => i.to)));
      commit({ ...draft, itemOrder: flat }, false);
    },
    moveSection: (from, to) => {
      const order = editableSections.map((s) => s.id);
      if (from < 0 || to < 0 || from >= order.length || to >= order.length || from === to) return;
      const next = [...order];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      commit({ ...draft, sectionOrder: next }, false);
    },
    reset: () => commit({ hidden: [], itemOrder: [], sectionOrder: [] }, true),
    isDefault:
      (draft.hidden ?? []).length === 0 &&
      sameOrder(draft.itemOrder, defaultItemOrder(NAV_SECTIONS)) &&
      sameOrder(draft.sectionOrder, defaultSectionOrder(NAV_SECTIONS)),
  };

  return <NavMenuContext.Provider value={value}>{children}</NavMenuContext.Provider>;
}

/** Unset and "saved, but identical to the default" are the same thing to Reset. */
function sameOrder(saved: string[] | undefined, defaults: string[]): boolean {
  if (!saved || saved.length === 0) return true;
  return mergeOrder(defaults, saved).join(",") === defaults.join(",");
}

export function useNavMenu(): NavMenu {
  const ctx = useContext(NavMenuContext);
  if (!ctx) throw new Error("useNavMenu must be used inside <NavMenuProvider>");
  return ctx;
}

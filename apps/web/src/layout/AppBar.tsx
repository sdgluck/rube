import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { routeTrail } from "#lib/routeTrail";
import ThemeToggle from "#components/ThemeToggle";
import styles from "./AppBar.module.css";

type Slots = { meta: HTMLElement | null; actions: HTMLElement | null };

const AppBarSlots = createContext<Slots>({ meta: null, actions: null });

/**
 * A crumb a page appends to the route trail, for the record it is showing.
 * `to` is what the crumb links to; the last one never links, because it is
 * where you already are.
 */
export type PageCrumb = {
  label: string;
  to?: string;
  /** Go back through history instead of to `to` — the drill-in came from a
   *  filtered list and `to` would throw the filters away. */
  onBack?: () => void;
};

type CrumbState = { crumbs: PageCrumb[]; onBackToParent?: () => void };

const SetPageCrumbs = createContext<(state: CrumbState) => void>(() => {});

/**
 * Where a page's counts, chips and buttons go now that pages have no header of
 * their own. Rendered as a portal into the app bar, so a page still declares
 * its actions next to the state they act on.
 */
export function PageActions({ slot = "actions", children }: { slot?: keyof Slots; children: ReactNode }) {
  const slots = useContext(AppBarSlots);
  const target = slots[slot];
  if (!target || children == null) return null;
  return createPortal(children, target);
}

/**
 * A drill-in page's own crumbs, appended to the route trail in the app bar.
 *
 * Every page that drills into a record used to draw its own `← Parent / Record`
 * line at the top of the body, one row below an app bar already saying where
 * you were — two breadcrumbs, in two type sizes, disagreeing about how far down
 * the trail you had come. The Settings pages never did this, because their trail
 * is complete in the bar; this is how every other page says the same thing.
 *
 * Data rather than a portal: the bar has to know a page contributed a crumb, or
 * the section above it would keep rendering as the current page and never link
 * back.
 *
 * `onBackToParent` hands the section crumb above these to history instead of to
 * its route — for a drill-in reached from a filtered list, where navigating to
 * `/media` afresh would throw the filters away.
 */
export function PageCrumbs({ crumbs, onBackToParent }: { crumbs: PageCrumb[]; onBackToParent?: () => void }) {
  const setCrumbs = useContext(SetPageCrumbs);
  // Crumbs are written inline at every call site, so a fresh array identity on
  // every render is the norm — the labels and targets are what actually
  // changed. The latest array is read from a ref so the effect can depend on
  // the labels alone and not resubscribe sixty times a second.
  const latest = useRef<CrumbState>({ crumbs, onBackToParent });
  latest.current = { crumbs, onBackToParent };
  const key = JSON.stringify(crumbs.map((c) => [c.label, c.to]));

  useEffect(() => {
    setCrumbs(latest.current);
    return () => setCrumbs({ crumbs: [] });
  }, [key, setCrumbs]);

  return null;
}

export function AppBarProvider({
  children,
  onOpenMenu,
  menuOpen = false,
}: {
  children: ReactNode;
  /** Set below --bp-md, where the sidebar is a drawer this bar opens. */
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}) {
  const [meta, setMeta] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [pageCrumbs, setPageCrumbs] = useState<CrumbState>({ crumbs: [] });
  const value = useMemo(() => ({ meta, actions }), [meta, actions]);

  return (
    <AppBarSlots.Provider value={value}>
      <SetPageCrumbs.Provider value={setPageCrumbs}>
        <AppBar
          metaRef={setMeta}
          actionsRef={setActions}
          pageCrumbs={pageCrumbs}
          onOpenMenu={onOpenMenu}
          menuOpen={menuOpen}
        />
        {children}
      </SetPageCrumbs.Provider>
    </AppBarSlots.Provider>
  );
}

/**
 * One layout at every width: the trail, the page's meta and its actions, then
 * the theme toggle. Below --bp-md a menu button leads, for the drawer, and the
 * bar wraps rather than clipping — a page with four actions gets a second row
 * of them instead of an overflow menu of its own invention.
 */
function AppBar({
  metaRef,
  actionsRef,
  pageCrumbs,
  onOpenMenu,
  menuOpen,
}: {
  metaRef: (el: HTMLElement | null) => void;
  actionsRef: (el: HTMLElement | null) => void;
  pageCrumbs: CrumbState;
  onOpenMenu?: () => void;
  menuOpen: boolean;
}) {
  const { pathname } = useLocation();
  const routeCrumbs: PageCrumb[] = routeTrail(pathname);
  const { crumbs, onBackToParent } = pageCrumbs;
  // The section directly above a page's own crumbs is the one "back" means.
  const parentIdx = routeCrumbs.length - 1;
  const trail: (PageCrumb & { record?: boolean })[] = [
    ...routeCrumbs.map((c, i) => (crumbs.length > 0 && i === parentIdx ? { ...c, onBack: onBackToParent } : c)),
    ...crumbs.map((c) => ({ ...c, record: true })),
  ];

  return (
    <div className={`app-bar ${styles.bar}`}>
      {onOpenMenu && (
        <button
          type="button"
          className={styles.menu}
          onClick={onOpenMenu}
          aria-label="Menu"
          aria-controls="app-drawer"
          aria-expanded={menuOpen}
        >
          <Menu size="1.8rem" strokeWidth={2} aria-hidden />
        </button>
      )}
      <nav className={styles.trail} aria-label="Breadcrumb">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1;
          // A record's own name keeps its capitalisation: the trail is
          // uppercased as a nav idiom, and a collection called
          // `"What the F*ck?!"` is not a nav label.
          const recordClass = crumb.record ? styles.crumbRecord : "";
          return (
            <span key={`${crumb.label}-${crumb.to ?? i}`} className={styles.trail}>
              {i > 0 && (
                <span className={styles.sep} aria-hidden>
                  /
                </span>
              )}
              {isLast || !crumb.to ? (
                <span className={`${styles.crumbCurrent} ${recordClass}`} aria-current={isLast ? "page" : undefined}>
                  {crumb.label}
                </span>
              ) : crumb.onBack ? (
                <a
                  href={crumb.to}
                  className={`${styles.crumbLink} ${recordClass}`}
                  onClick={(e) => {
                    e.preventDefault();
                    crumb.onBack?.();
                  }}
                >
                  {crumb.label}
                </a>
              ) : (
                <Link to={crumb.to} className={`${styles.crumbLink} ${recordClass}`}>
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
      <span className={styles.meta} ref={metaRef} />
      <span className={styles.spacer} />
      <span className={styles.actions} ref={actionsRef} />
      {/* After the page's own actions, not inside them: this belongs to the
        app, and a page that portals a primary button in should still have
        the rightmost say about its own screen. */}
      <span className={styles.theme}>
        <ThemeToggle compact />
      </span>
    </div>
  );
}

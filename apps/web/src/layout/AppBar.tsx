import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, MoreHorizontal, Search } from "lucide-react";
import { getPlatform, navigateBack } from "@tinkerbell/native-client";
import { routeTrail } from "#lib/routeTrail";
import { openSearch } from "#lib/openSearch";
import { useIsPhone } from "#hooks/useMediaQuery";
import ActionSheet, { type SheetAction } from "#components/ActionSheet";
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

export function AppBarProvider({ children, notices }: { children: ReactNode; notices?: ReactNode }) {
  const [meta, setMeta] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [pageCrumbs, setPageCrumbs] = useState<CrumbState>({ crumbs: [] });
  const value = useMemo(() => ({ meta, actions }), [meta, actions]);

  return (
    <AppBarSlots.Provider value={value}>
      <SetPageCrumbs.Provider value={setPageCrumbs}>
        <AppBar metaRef={setMeta} actionsRef={setActions} pageCrumbs={pageCrumbs} notices={notices} />
        {children}
      </SetPageCrumbs.Provider>
    </AppBarSlots.Provider>
  );
}

function AppBar({
  metaRef,
  actionsRef,
  pageCrumbs,
  notices,
}: {
  metaRef: (el: HTMLElement | null) => void;
  actionsRef: (el: HTMLElement | null) => void;
  pageCrumbs: CrumbState;
  /** Server-wide notices, drawn under the bar and above any large title. */
  notices?: ReactNode;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const platform = getPlatform();
  const routeCrumbs: PageCrumb[] = routeTrail(pathname);
  const { crumbs, onBackToParent } = pageCrumbs;
  // The section directly above a page's own crumbs is the one "back" means.
  const parentIdx = routeCrumbs.length - 1;
  const trail: (PageCrumb & { record?: boolean })[] = [
    ...routeCrumbs.map((c, i) => (crumbs.length > 0 && i === parentIdx ? { ...c, onBack: onBackToParent } : c)),
    ...crumbs.map((c) => ({ ...c, record: true })),
  ];

  // ─── The phone header ────────────────────────────────────────────────
  // The same trail, read the way a native navigation bar reads it: the last
  // crumb is the screen's title, the one before it is where Back goes.
  const current = trail[trail.length - 1];
  const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;
  // iOS draws a large title on the top screen of each tab, which shrinks into
  // the bar as you scroll; a pushed screen and every Android screen have the
  // title in the bar from the start.
  const largeTitle = isPhone && platform === "ios" && !parent && !!current;
  const scrolled = useScrolledPast(largeTitle ? "large" : "top", isPhone);

  const goBack = () => {
    if (!parent) return;
    if (parent.onBack) return parent.onBack();
    // Back means the previous screen, as it does natively; with no in-app
    // history (a deep link straight into a detail page) it means the parent.
    navigateBack(() => parent.to && navigate(parent.to));
  };

  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  const overflow = useActionsOverflow(actionsEl, isPhone ? (largeTitle ? 2 : 1) : Infinity);
  const [overflowOpen, setOverflowOpen] = useState(false);

  return (
    <>
      <div
        className={`app-bar ${styles.bar}`}
        data-scrolled={scrolled || undefined}
        data-large-title={largeTitle || undefined}
      >
        {isPhone && parent && (
          <button type="button" className={styles.back} onClick={goBack} aria-label={`Back to ${parent.label}`}>
            {platform === "android" ? (
              <ArrowLeft size="2.4rem" strokeWidth={2} aria-hidden />
            ) : (
              <>
                <ChevronLeft size="2.8rem" strokeWidth={2.2} aria-hidden />
                <span className={styles.backLabel}>{parent.label}</span>
              </>
            )}
          </button>
        )}
        {isPhone && current && (
          <span
            className={`${styles.phoneTitle} ${current.record ? styles.crumbRecordPhone : ""}`}
            aria-hidden={largeTitle && !scrolled}
          >
            {current.label}
          </span>
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
        {/* A root screen's way into search, since a phone has no sidebar or ⌘K. */}
        {isPhone && !parent && (
          <button type="button" className={styles.overflow} onClick={openSearch} aria-label="Search">
            <Search size="2.1rem" strokeWidth={2} aria-hidden />
          </button>
        )}
        {overflow.hidden.length > 0 && (
          <button
            type="button"
            className={styles.overflow}
            onClick={() => setOverflowOpen(true)}
            aria-label="More actions"
          >
            <MoreHorizontal size="2.2rem" strokeWidth={2} aria-hidden />
          </button>
        )}
        <span
          className={styles.actions}
          data-visible={overflow.visible}
          ref={(el) => {
            actionsRef(el);
            setActionsEl(el);
          }}
        />
        {/* After the page's own actions, not inside them: this belongs to the
          app, and a page that portals a primary button in should still have
          the rightmost say about its own screen. On a phone it lives in
          Settings → Appearance instead: a native bar has no room for it. */}
        <span className={styles.theme}>
          <ThemeToggle compact />
        </span>
      </div>
      {notices}
      {largeTitle && <h1 className={`app-large-title ${styles.largeTitle}`}>{current!.label}</h1>}
      {isPhone && <ActionSheet open={overflowOpen} onClose={() => setOverflowOpen(false)} actions={overflow.hidden} />}
    </>
  );
}

/**
 * Whether the page has scrolled far enough for the bar to change: past the
 * large title on an iOS root screen (the small title then fades into the
 * bar), or off the very top anywhere else (the bar gains its hairline or
 * Material elevation). The phone layout scrolls the document.
 */
function useScrolledPast(mode: "large" | "top", enabled: boolean): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const title = document.querySelector<HTMLElement>(".app-large-title");
      const bar = document.querySelector<HTMLElement>(".app-bar");
      const threshold = mode === "large" && title && bar ? title.offsetTop + title.offsetHeight - bar.offsetHeight : 1;
      setPast(window.scrollY >= threshold);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [mode, enabled]);
  return past;
}

/**
 * Fit a page's header actions into a phone's navigation bar.
 *
 * Pages portal their buttons into the bar without knowing its width — on a
 * desktop there is room for five; a phone's bar holds one or two. The last
 * `limit` stay (pages put the primary action last), and the rest move into a
 * "⋯" action sheet whose rows click the real, hidden buttons, so every page
 * gets this without a line of its own code. Watched with a MutationObserver
 * because pages add and remove actions as their state changes.
 */
function useActionsOverflow(el: HTMLElement | null, limit: number): { visible?: number; hidden: SheetAction[] } {
  const [count, setCount] = useState(0);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!el) return;
    const update = () => {
      setCount(el.children.length);
      setVersion((v) => v + 1);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, [el]);

  return useMemo(() => {
    if (!el || count <= limit) return { hidden: [] };
    // One slot goes to the "⋯" button itself.
    const visible = Math.max(0, limit - 1);
    const children = [...el.children] as HTMLElement[];
    const hidden = children.slice(0, children.length - visible);
    return {
      visible,
      hidden: hidden
        .map((child) => {
          const target = child.matches("button, a, input, label")
            ? child
            : child.querySelector<HTMLElement>("button, a, input, label");
          const label = (
            target?.getAttribute("aria-label") ||
            child.textContent ||
            target?.getAttribute("title") ||
            ""
          ).trim();
          return {
            label,
            disabled: target?.hasAttribute("disabled"),
            onSelect: () => target?.click(),
          };
        })
        .filter((a) => a.label),
    };
    // `version` is the signal that the children changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, count, limit, version]);
}

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { routeTrail } from "#/nav";
import styles from "./AppBar.module.css";

type Slots = { meta: HTMLElement | null; actions: HTMLElement | null };

const AppBarSlots = createContext<Slots>({ meta: null, actions: null });

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

export function AppBarProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ meta, actions }), [meta, actions]);

  return (
    <AppBarSlots.Provider value={value}>
      <AppBar metaRef={setMeta} actionsRef={setActions} />
      {children}
    </AppBarSlots.Provider>
  );
}

function AppBar({
  metaRef,
  actionsRef,
}: {
  metaRef: (el: HTMLElement | null) => void;
  actionsRef: (el: HTMLElement | null) => void;
}) {
  const { pathname } = useLocation();
  const trail = routeTrail(pathname);

  return (
    <div className={`app-bar ${styles.bar}`}>
      <nav className={styles.trail} aria-label="Breadcrumb">
        {trail.map((crumb, i) => {
          const isLast = i === trail.length - 1;
          return (
            <span key={crumb.to} className={styles.trail}>
              {i > 0 && (
                <span className={styles.sep} aria-hidden>
                  /
                </span>
              )}
              {isLast ? (
                <span className={styles.crumbCurrent} aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link to={crumb.to} className={styles.crumbLink}>
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
    </div>
  );
}

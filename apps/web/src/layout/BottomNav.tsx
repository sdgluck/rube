import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { SidebarStreamCount } from "#layout/Sidebar";
import { MORE_PAGES, MORE_SECTIONS, type NavItem } from "#/nav";
import { trpc } from "#/trpc";

const ICON_PROPS = {
  className: "bottom-nav-icon",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

const TABS = [
  { to: "/stats", label: "Stats", path: "M18 20V10M12 20V4M6 20v-6", badge: true },
  {
    to: "/collections",
    label: "Collections",
    rects: true,
  },
  {
    to: "/jobs",
    label: "Jobs",
    path: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
  },
] as const;

type SheetMetrics = Record<string, number | "ok" | "error" | null>;

/** The card's second line: what this page currently holds, in mono. */
function sheetMeta(item: NavItem, metrics: SheetMetrics | undefined): { dot?: string; text: string } {
  if (!item.metric || !metrics) return { text: "" };
  if (item.metric.kind === "streams") return { text: "" };
  const value = metrics[item.metric.key];
  if (item.metric.kind === "status") {
    if (value === "ok") return { dot: "ok", text: "ok" };
    if (value === "error") return { dot: "error", text: "failed" };
    return { text: "never run" };
  }
  if (typeof value !== "number" || value === 0) return { text: "—" };
  if (item.metric.key === "eventsErrors24h") {
    return { dot: "error", text: `${value} error${value === 1 ? "" : "s"} 24h` };
  }
  return { text: value.toLocaleString() };
}

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  // Only fetched once the sheet has been opened: the rail that normally drives
  // this query isn't rendered on mobile.
  const metricsQuery = trpc.nav.metrics.useQuery(undefined, {
    enabled: moreOpen,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const location = useLocation();
  const closeMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMore();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen, closeMore]);

  const isMoreActive = MORE_PAGES.some((p) => location.pathname.startsWith(p.to));

  return (
    <>
      {moreOpen && <div className="bottom-sheet-overlay" onClick={closeMore} />}
      {/*
       * The sheet stays mounted so it can animate in and out. `inert` keeps its
       * links out of the tab order and off the accessibility tree while it is
       * translated off-screen — without it, tabbing through a mobile page
       * walked into a dozen invisible nav links.
       */}
      <div className={`bottom-sheet ${moreOpen ? "bottom-sheet-open" : ""}`} inert={!moreOpen}>
        <div className="bottom-sheet-handle" />
        <nav aria-label="More pages">
          {MORE_SECTIONS.map((section) => (
            <div key={section.label} className="bottom-sheet-section">
              <div className="bottom-sheet-section-title">{section.label}</div>
              <div className="bottom-sheet-nav">
                {section.items.map((p) => {
                  const meta = sheetMeta(p, metricsQuery.data as SheetMetrics | undefined);
                  return (
                    <NavLink key={p.to} to={p.to} className="bottom-sheet-link" onClick={closeMore}>
                      <span className="bottom-sheet-link-label">
                        {meta.dot && <span className={`bottom-sheet-dot bottom-sheet-dot-${meta.dot}`} />}
                        {p.label}
                      </span>
                      {meta.text && <span className="bottom-sheet-link-meta">{meta.text}</span>}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
      <nav className="bottom-nav" aria-label="Primary">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className="bottom-nav-item">
            <svg {...ICON_PROPS}>
              {"rects" in tab ? (
                <>
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </>
              ) : (
                <path d={tab.path} />
              )}
            </svg>
            <span className="bottom-nav-label">{tab.label}</span>
            {"badge" in tab && <SidebarStreamCount />}
          </NavLink>
        ))}
        <button
          className={`bottom-nav-item ${isMoreActive ? "active" : ""}`}
          onClick={() => setMoreOpen((o) => !o)}
          type="button"
          aria-expanded={moreOpen}
          aria-label="More pages"
        >
          <svg {...ICON_PROPS}>
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
          <span className="bottom-nav-label">More</span>
        </button>
      </nav>
    </>
  );
}

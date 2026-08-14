import { NavLink } from "react-router-dom";
import { SidebarStreamCount } from "#layout/Sidebar";

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
  {
    to: "/more",
    label: "More",
    dots: true,
  },
] as const;

/**
 * Mobile tab bar. Every destination is a route — "More" is the `/more` page,
 * not an overlay, so the back button, scroll restoration and deep links all
 * work on it the same way they do everywhere else.
 */
export default function BottomNav() {
  return (
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
            ) : "dots" in tab ? (
              <>
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </>
            ) : (
              <path d={tab.path} />
            )}
          </svg>
          <span className="bottom-nav-label">{tab.label}</span>
          {"badge" in tab && <SidebarStreamCount />}
        </NavLink>
      ))}
    </nav>
  );
}

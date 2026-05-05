import { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { SidebarStreamCount } from "#layout/Sidebar";
import { MORE_PAGES, MORE_SECTIONS } from "#/nav";

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const closeMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const isMoreActive = MORE_PAGES.some((p) => location.pathname.startsWith(p.to));

  return (
    <>
      {moreOpen && <div className="bottom-sheet-overlay" onClick={closeMore} />}
      <div className={`bottom-sheet ${moreOpen ? "bottom-sheet-open" : ""}`}>
        <div className="bottom-sheet-handle" />
        <nav className="bottom-sheet-nav">
          {MORE_SECTIONS.map((section) => (
            <div key={section.label} className="bottom-sheet-section">
              <div className="nav-section-title">{section.label}</div>
              {section.items.map((p) => (
                <NavLink key={p.to} to={p.to} className="bottom-sheet-link" onClick={closeMore}>
                  {p.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <nav className="bottom-nav">
        <NavLink to="/stats" className="bottom-nav-item">
          <svg
            className="bottom-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 20V10M12 20V4M6 20v-6" />
          </svg>
          <span className="bottom-nav-label">Stats</span>
          <SidebarStreamCount />
        </NavLink>
        <NavLink to="/collections" className="bottom-nav-item">
          <svg
            className="bottom-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span className="bottom-nav-label">Collections</span>
        </NavLink>
        <NavLink to="/jobs" className="bottom-nav-item">
          <svg
            className="bottom-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span className="bottom-nav-label">Jobs</span>
        </NavLink>
        <button
          className={`bottom-nav-item ${isMoreActive ? "active" : ""}`}
          onClick={() => setMoreOpen((o) => !o)}
          type="button"
        >
          <svg
            className="bottom-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
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

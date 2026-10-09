import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { haptic, markTabNavigation } from "@tinkerbell/native-client";
import { SidebarStreamCount } from "#layout/Sidebar";
import { useNavMenu } from "#hooks/useNavMenu";
import { navIcon } from "#layout/navIcons";
import { MORE, tabFor, tabTapAction } from "./tabMemory";

/**
 * Mobile tab bar. Every destination is a route — "More" is the `/more` page,
 * not an overlay, so the back button, scroll restoration and deep links all
 * work on it the same way they do everywhere else.
 *
 * The tabs used to be a literal here with a hand-drawn SVG path each, which was
 * fine while there were exactly three of them and they never changed. Now that
 * the admin picks them, both halves come from data: the routes from the shared
 * menu state, the icons from `navIcons`. The streams badge follows whichever
 * tab declares that metric rather than being pinned to the first slot.
 *
 * Each tab keeps its own place, as native tab bars do: switching away from a
 * collection's detail and back lands on that collection, not on the list.
 * Tapping the tab you're on pops to its root, and again scrolls to the top
 * (see `tabMemory.ts`). Switches don't animate — tab bars switch instantly.
 */
export default function BottomNav() {
  const { bottomTabs } = useNavMenu();
  const MoreIcon = navIcon("/more");
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const roots = bottomTabs.map((t) => t.to);
  const currentTab = tabFor(pathname, roots);
  const remembered = useRef(new Map<string, string>());

  useEffect(() => {
    remembered.current.set(currentTab, pathname + search);
  }, [currentTab, pathname, search]);

  const tabs = [
    ...bottomTabs.map((tab) => ({ to: tab.to, label: tab.label, Icon: navIcon(tab.to), metric: tab.metric })),
    { to: MORE, label: "More", Icon: MoreIcon, metric: undefined },
  ];

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {tabs.map(({ to, label, Icon, metric }) => {
        const active = currentTab === to;
        return (
          <Link
            key={to}
            to={to}
            className={`bottom-nav-item ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              const action = tabTapAction({
                tapped: to,
                currentTab,
                pathname,
                remembered: remembered.current.get(to),
              });
              haptic("selection");
              if (action.kind === "scrollTop") {
                window.scrollTo({ top: 0, behavior: "smooth" });
                return;
              }
              markTabNavigation();
              navigate(action.to);
            }}
          >
            <Icon className="bottom-nav-icon" strokeWidth={2} aria-hidden focusable={false} />
            <span className="bottom-nav-label">{label}</span>
            {metric?.kind === "streams" && <SidebarStreamCount />}
          </Link>
        );
      })}
    </nav>
  );
}

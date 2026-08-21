import { NavLink } from "react-router-dom";
import { SidebarStreamCount } from "#layout/Sidebar";
import { useNavMenu } from "#hooks/useNavMenu";
import { navIcon } from "#layout/navIcons";

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
 */
export default function BottomNav() {
  const { bottomTabs } = useNavMenu();
  const MoreIcon = navIcon("/more");

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {bottomTabs.map((tab) => {
        const Icon = navIcon(tab.to);
        return (
          <NavLink key={tab.to} to={tab.to} className="bottom-nav-item">
            <Icon className="bottom-nav-icon" strokeWidth={2} aria-hidden focusable={false} />
            <span className="bottom-nav-label">{tab.label}</span>
            {tab.metric?.kind === "streams" && <SidebarStreamCount />}
          </NavLink>
        );
      })}
      <NavLink to="/more" className="bottom-nav-item">
        <MoreIcon className="bottom-nav-icon" strokeWidth={2} aria-hidden focusable={false} />
        <span className="bottom-nav-label">More</span>
      </NavLink>
    </nav>
  );
}

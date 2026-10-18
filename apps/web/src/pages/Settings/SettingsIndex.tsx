import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Bot,
  Brush,
  Clapperboard,
  Database,
  Download,
  FileClock,
  Film,
  Gauge,
  HardDriveDownload,
  Heart,
  House,
  History,
  Image,
  KeyRound,
  ListChecks,
  Mail,
  Bell,
  Rocket,
  Server,
  Settings2,
  Shield,
  Smartphone,
  Tags,
  Trash2,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import SearchInput from "#components/SearchInput";
import ListRow, { RowIcon } from "#components/list/ListRow";
import ListSection from "#components/list/ListSection";
import { useIsPhone } from "#hooks/useMediaQuery";
import { SETTINGS_SECTIONS } from "./sections";
import styles from "./Settings.module.css";

/** Each page's icon tile on the phone index. */
const ICONS: Record<string, LucideIcon> = {
  "/settings/plex": Server,
  "/settings/ai": Bot,
  "/settings/arrs": Download,
  "/settings/databases": Database,
  "/settings/home-assistant": House,
  "/settings/cleanup": Trash2,
  "/settings/watchlist": Heart,
  "/settings/metadata": Tags,
  "/settings/portal": Users,
  "/settings/notifications": Bell,
  "/settings/digest": Mail,
  "/settings/posters": Image,
  "/settings/appearance": Brush,
  "/settings/prerolls": Clapperboard,
  "/onboarding": Rocket,
  "/settings/security": Shield,
  "/settings/api": KeyRound,
  "/settings/mobile": Smartphone,
  "/settings/migrate": HardDriveDownload,
  "/settings/maintenance": Wrench,
  "/settings/backup": FileClock,
  "/settings/history": History,
  "/settings/bandwidth": Gauge,
  "/settings/health": Activity,
  "/settings/stress-test": Film,
  "/settings/changelog": ListChecks,
  "/settings/credits": BookOpen,
};

/**
 * `/settings` itself. On a desktop it has always been a redirect to the first
 * page, because the rail beside every page is the index. A phone has no room
 * for the rail, so there it is a page of its own: the rail's links as a
 * filterable list, each opening its page.
 */
export default function SettingsIndex() {
  const isPhone = useIsPhone();
  const [filter, setFilter] = useState("");

  const sections = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.map((section) => ({
      ...section,
      links: section.heading.toLowerCase().includes(needle)
        ? section.links
        : section.links.filter((link) => link.label.toLowerCase().includes(needle)),
    })).filter((section) => section.links.length > 0);
  }, [filter]);

  if (!isPhone) return <Navigate to="/settings/plex" replace />;

  return (
    <div className={styles.phoneIndex}>
      <SearchInput placeholder="Search settings" ariaLabel="Filter settings" value={filter} onChange={setFilter} fill />
      {sections.length === 0 && <p className={styles.railEmpty}>Nothing matches “{filter}”.</p>}
      {sections.map((section) => (
        <ListSection key={section.heading} title={section.heading}>
          {section.links.map((link) => {
            const Icon = ICONS[link.to] ?? Settings2;
            return (
              <ListRow
                key={link.to}
                to={link.to}
                leading={
                  <RowIcon tone={link.to === "/settings/security" ? "danger" : "accent"}>
                    <Icon />
                  </RowIcon>
                }
                title={link.label}
              />
            );
          })}
        </ListSection>
      ))}
    </div>
  );
}

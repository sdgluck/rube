import { NavLink, Outlet } from "react-router-dom";
import { trpc } from "#/trpc";
import SettingsPageHeader from "#pages/Settings/SettingsPageHeader";
import styles from "#pages/Settings/Settings.module.css";
import { DATABASE_SERVICES, DATABASE_TAB_ORDER } from "./databases.config";

function isServiceConfigured(cfg: Record<string, unknown>, apiKeyKey: string): boolean {
  const v = cfg[apiKeyKey];
  return typeof v === "string" && v.length > 0;
}

export default function SettingsDatabases() {
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const cfg = (configQuery.data ?? {}) as Record<string, unknown>;

  return (
    <div>
      <SettingsPageHeader title="Databases" />
      <nav className={styles.subTabs} aria-label="Database services">
        {DATABASE_TAB_ORDER.map((id) => {
          const svc = DATABASE_SERVICES[id];
          return (
            <NavLink
              key={id}
              to={`/settings/databases/${id}`}
              className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
            >
              {isServiceConfigured(cfg, svc.apiKeyConfigKey) && <span className={styles.enabledDot} />}
              {svc.title}
            </NavLink>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}

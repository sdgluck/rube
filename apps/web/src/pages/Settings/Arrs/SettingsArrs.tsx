import { NavLink, Outlet } from "react-router-dom";
import { trpc } from "#/trpc";
import SettingsPageHeader from "#pages/Settings/SettingsPageHeader";
import styles from "#pages/Settings/Settings.module.css";
import { ARRS_SERVICES, ARRS_TAB_ORDER } from "./arrs.config";

function isServiceConfigured(cfg: Record<string, unknown>, urlKey: string, apiKeyKey: string): boolean {
  const url = cfg[urlKey];
  const apiKey = cfg[apiKeyKey];
  return typeof url === "string" && url.length > 0 && typeof apiKey === "string" && apiKey.length > 0;
}

export default function SettingsArrs() {
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const cfg = (configQuery.data ?? {}) as Record<string, unknown>;

  return (
    <div>
      <SettingsPageHeader title="Media Managers" />
      <nav className={styles.subTabs} aria-label="Media manager services">
        {ARRS_TAB_ORDER.map((id) => {
          const svc = ARRS_SERVICES[id];
          return (
            <NavLink
              key={id}
              to={`/settings/arrs/${id}`}
              className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
            >
              {isServiceConfigured(cfg, svc.urlConfigKey, svc.apiKeyConfigKey) && (
                <span className={styles.enabledDot} />
              )}
              {svc.title}
            </NavLink>
          );
        })}
        {/* Not a service: extra instances of the two above. */}
        <NavLink
          to="/settings/arrs/instances"
          className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
        >
          Instances
        </NavLink>
        <NavLink
          to="/settings/arrs/download-clients"
          className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
        >
          {Array.isArray(cfg.global_download_clients) && cfg.global_download_clients.length > 0 && (
            <span className={styles.enabledDot} />
          )}
          Download clients
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

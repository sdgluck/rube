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
      <SettingsPageHeader
        title="Arrs"
        description="Connect Radarr, Sonarr, and Jellyseerr/Overseerr so rules can request and manage media."
      />
      <nav className={styles.subTabs}>
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
      </nav>
      <Outlet />
    </div>
  );
}

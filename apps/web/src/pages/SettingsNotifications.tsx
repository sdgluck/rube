import { NavLink, Outlet } from "react-router-dom";
import { trpc } from "#/trpc";
import styles from "./Settings.module.css";

const TABS = [
  {
    to: "discord",
    label: "Discord",
    credentialKeys: ["global_discord_webhook_url"],
    eventsKey: "global_discord_events",
  },
  {
    to: "gotify",
    label: "Gotify",
    credentialKeys: ["global_gotify_url", "global_gotify_token"],
    eventsKey: "global_gotify_events",
  },
  {
    to: "lunasea",
    label: "LunaSea",
    credentialKeys: ["global_lunasea_webhook_url"],
    eventsKey: "global_lunasea_events",
  },
  {
    to: "pushbullet",
    label: "Pushbullet",
    credentialKeys: ["global_pushbullet_token"],
    eventsKey: "global_pushbullet_events",
  },
  {
    to: "pushover",
    label: "Pushover",
    credentialKeys: ["global_pushover_api_key", "global_pushover_user_key"],
    eventsKey: "global_pushover_events",
  },
  {
    to: "slack",
    label: "Slack",
    credentialKeys: ["global_slack_webhook_url"],
    eventsKey: "global_slack_events",
  },
  {
    to: "telegram",
    label: "Telegram",
    credentialKeys: ["global_telegram_bot_token", "global_telegram_chat_id"],
    eventsKey: "global_telegram_events",
  },
  {
    to: "webhook",
    label: "Webhook",
    credentialKeys: ["global_webhook_url"],
    eventsKey: "global_webhook_events",
  },
] as const;

function isServiceEnabled(cfg: Record<string, unknown>, tab: (typeof TABS)[number]): boolean {
  const hasCredentials = tab.credentialKeys.every((k) => {
    const v = cfg[k];
    return typeof v === "string" && v.length > 0;
  });
  const events = cfg[tab.eventsKey];
  const hasEvents = Array.isArray(events) && events.length > 0;
  return hasCredentials && hasEvents;
}

export default function SettingsNotifications() {
  const configQuery = trpc.config.get.useQuery(undefined, { refetchOnWindowFocus: false });
  const cfg = (configQuery.data ?? {}) as Record<string, unknown>;

  return (
    <div>
      <nav className={styles.subTabs}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={`/settings/notifications/${tab.to}`}
            className={({ isActive }) => `${styles.subTab} ${isActive ? styles.subTabActive : ""}`}
          >
            {isServiceEnabled(cfg, tab) && <span className={styles.enabledDot} />}
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

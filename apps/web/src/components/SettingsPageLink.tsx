import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SETTINGS_LINKS } from "#pages/Settings/sections";
import styles from "./SettingsPageLink.module.css";

/**
 * "Settings › Plex" as a link to the page it names.
 *
 * A dependency spelled out as prose ("set a key in Settings → AI first") asks
 * the reader to go and find the page; this takes them there. The label comes
 * from the settings rail so a renamed page can't leave stale directions behind.
 */
export default function SettingsPageLink({ to, children }: { to: string; children?: ReactNode }) {
  const label = SETTINGS_LINKS.find((l) => l.to === to)?.label;
  return (
    <Link to={to} className={styles.link}>
      {children ?? `Settings › ${label ?? to}`}
    </Link>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import styles from "./AuthBanner.module.css";

const DISMISS_KEY = "tb_auth_banner_dismissed";

/**
 * The first-run offer to turn authentication on.
 *
 * Deliberately a banner and not a forced step: someone with a working
 * loopback-only install shouldn't be locked out by a version bump, and the
 * honest framing is "you can have this now", not "you must". Dismissible, and
 * the dismissal sticks — nagging a user who has decided is just noise.
 */
export default function AuthBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");
  const statusQuery = trpc.auth.status.useQuery(undefined, { retry: false });

  const status = statusQuery.data;
  if (dismissed || !status || status.configured) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className={`app-notice ${styles.banner}`} role="status">
      <span className={styles.text}>
        Anyone who can reach this port can change anything here. You can require a Plex sign-in instead — only the
        account that owns this server gets in.
      </span>
      <span className={styles.actions}>
        <Link to="/settings/security" className={styles.link}>
          Set it up
        </Link>
        <button type="button" className={styles.dismiss} onClick={dismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}

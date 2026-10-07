import { useEffect } from "react";
import { unlock } from "@tinkerbell/native-client";
import styles from "./auth.module.css";

/** The app lock (Settings → Mobile app). Prompts at once; the button is for after a cancel. */
export default function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  async function prompt() {
    if (await unlock("Unlock Tinkerbell")) onUnlocked();
  }

  useEffect(() => {
    void prompt();
    // Once per lock; a re-prompt is the button's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.loginCard}>
        <h1 className={styles.title}>Tinkerbell</h1>
        <p className={styles.lede}>Locked.</p>
        <button type="button" className={styles.primaryButton} onClick={prompt}>
          Unlock
        </button>
      </div>
    </div>
  );
}

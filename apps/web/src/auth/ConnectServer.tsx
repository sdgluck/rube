import { useState } from "react";
import { probeServer, saveServer, type ServerCheck } from "@tinkerbell/native-client";
import styles from "./auth.module.css";

/**
 * The native app's first screen: which Tinkerbell is this?
 *
 * The UI ships inside the app, so unlike the browser SPA it has no server of
 * its own to talk to. The address is checked before it's saved — `auth.server`
 * says whether it is a Tinkerbell, which of the two ports, and whether it's new
 * enough — so a typo is a sentence here rather than a sign-in that fails later.
 */
export default function ConnectServer({ initial = "" }: { initial?: string }) {
  const [address, setAddress] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    const check = await probeServer(address, "tinkerbell-admin");
    setChecking(false);
    if (check.ok) await saveServer(check.server);
    else setError(explain(check));
  }

  return (
    <div className={styles.page}>
      <div className={styles.loginCard}>
        <h1 className={styles.title}>Tinkerbell</h1>
        <p className={styles.lede}>
          Enter the address you open Tinkerbell at in a browser — or scan the code under Settings → Mobile app.
        </p>
        {error && <p className={styles.error}>{error}</p>}
        <form className={styles.form} onSubmit={connect}>
          <input
            className={styles.serverInput}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="http://192.168.1.10:3000"
            aria-label="Server address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className={styles.primaryButton} disabled={checking || !address.trim()}>
            {checking ? "Checking…" : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}

function explain(check: Extract<ServerCheck, { ok: false }>): string {
  switch (check.reason) {
    case "wrong-app":
      return "That's the Tinkerbell portal, the page for people you share with. Use the admin address — port 3000 by default.";
    case "too-old":
      return `That server runs Tinkerbell ${check.detail}, which is too old for this app. Update it and try again.`;
    case "not-tinkerbell":
      return "Something answered at that address, but it isn't Tinkerbell.";
    case "unreachable":
      return `Couldn't reach that address${check.detail ? ` (${check.detail})` : ""}. Is the phone on the same network, and is the port right?`;
  }
}

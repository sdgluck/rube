import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import styles from "./auth.module.css";

/**
 * Signing in leaves the page entirely — Plex takes over the tab and sends the
 * browser back afterwards — so nothing in React state survives the round trip.
 * This flag is the reminder to resume polling on the way back.
 *
 * It is only a flag. The handshake itself lives in an HttpOnly cookie the
 * server set when the flow began, which is what ties the sign-in to this
 * browser; nothing here is worth stealing, and a stale flag costs one
 * "expired" round trip.
 */
const PENDING_KEY = "tb_admin_signin_pending";

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 60; // two minutes, then give up and let them retry

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const startMutation = trpc.auth.start.useMutation();
  const pollMutation = trpc.auth.poll.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(() => !!localStorage.getItem(PENDING_KEY));

  // Coming back from Plex: finish the handshake. The server reads which PIN
  // this is from the handshake cookie, so there is nothing to pass.
  useEffect(() => {
    if (!localStorage.getItem(PENDING_KEY)) return;
    let cancelled = false;
    let attempts = 0;

    const stop = () => {
      localStorage.removeItem(PENDING_KEY);
      setFinishing(false);
    };

    const tick = async () => {
      attempts++;
      try {
        const res = await pollMutation.mutateAsync();
        if (res.status === "ok") {
          stop();
          onSignedIn();
          return;
        }
        if (res.status === "expired") {
          // The handshake cookie is gone or too old — nothing to finish.
          stop();
          setError("That sign-in took too long. Try again.");
          return;
        }
      } catch (err) {
        // A refusal (not an admin, rate-limited, owner unresolvable) is
        // terminal — retrying can only produce it again.
        stop();
        setError(err instanceof Error ? err.message : "Sign-in failed.");
        return;
      }
      if (!cancelled && attempts < POLL_ATTEMPTS) setTimeout(tick, POLL_INTERVAL_MS);
      else stop();
    };
    tick();
    return () => {
      cancelled = true;
    };
    // Runs once on mount; the pending flag is read from storage inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn() {
    setError(null);
    startMutation.mutate(undefined, {
      onSuccess: ({ authUrl }) => {
        localStorage.setItem(PENDING_KEY, "1");
        window.location.href = authUrl;
      },
      onError: (err) => setError(err.message),
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.loginCard}>
        <h1 className={styles.title}>Tinkerbell</h1>
        <p className={styles.lede}>
          {finishing
            ? "Finishing sign-in with Plex…"
            : "Sign in with the Plex account that owns this server to manage it."}
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <button type="button" className={styles.plexButton} onClick={signIn} disabled={finishing}>
          {startMutation.isPending ? "Opening Plex…" : "Sign in with Plex"}
        </button>

        <p className={styles.hint}>
          Locked out? Set <code>TINKERBELL_DISABLE_AUTH=1</code> on the server and restart to get back in.
        </p>
      </div>
    </div>
  );
}

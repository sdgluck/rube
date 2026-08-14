import { useEffect, useState } from "react";
import { trpc } from "#/trpc";
import styles from "./auth.module.css";

/**
 * The pin id is parked in localStorage because signing in leaves the page
 * entirely — Plex takes over the tab and sends the browser back afterwards,
 * so nothing in React state survives the round trip.
 */
const PIN_KEY = "tb_admin_pin";

const POLL_INTERVAL_MS = 2000;
const POLL_ATTEMPTS = 60; // two minutes, then give up and let them retry

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const startMutation = trpc.auth.start.useMutation();
  const pollMutation = trpc.auth.poll.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(() => !!localStorage.getItem(PIN_KEY));

  // Coming back from Plex: finish the handshake by polling the pin until it
  // carries a token.
  useEffect(() => {
    const pinId = localStorage.getItem(PIN_KEY);
    if (!pinId) return;
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      attempts++;
      try {
        const res = await pollMutation.mutateAsync({ id: Number(pinId) });
        if (res.status === "ok") {
          localStorage.removeItem(PIN_KEY);
          setFinishing(false);
          onSignedIn();
          return;
        }
      } catch (err) {
        // A refusal (not the owner, rate-limited, owner unresolvable) is
        // terminal — retrying the same pin can only produce it again.
        localStorage.removeItem(PIN_KEY);
        setFinishing(false);
        setError(err instanceof Error ? err.message : "Sign-in failed.");
        return;
      }
      if (!cancelled && attempts < POLL_ATTEMPTS) setTimeout(tick, POLL_INTERVAL_MS);
      else {
        localStorage.removeItem(PIN_KEY);
        setFinishing(false);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
    // Runs once on mount; the pin id is read from storage inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn() {
    setError(null);
    startMutation.mutate(
      { forwardUrl: window.location.href },
      {
        onSuccess: ({ id, authUrl }) => {
          localStorage.setItem(PIN_KEY, String(id));
          window.location.href = authUrl;
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
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

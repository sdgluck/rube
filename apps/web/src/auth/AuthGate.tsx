import { useEffect, type ReactNode } from "react";
import { trpc, UNAUTHORIZED_EVENT } from "#/trpc";
import SignIn from "./SignIn";
import styles from "./auth.module.css";

/**
 * Decides whether the app renders at all.
 *
 * `auth.status` is the one query that works without a session, so it runs
 * first and everything else waits on it. Three outcomes: auth isn't required
 * (render the app — an existing install must behave exactly as it did before
 * this feature landed), required and signed in (render the app), required and
 * not (render the sign-in screen instead of a page full of failed queries).
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const statusQuery = trpc.auth.status.useQuery(undefined, {
    // Cheap, and the answer changing is the whole point of asking.
    staleTime: 0,
    retry: false,
  });

  // A session that expires while the app is open surfaces as a 401 from
  // whatever query noticed first. Re-reading the status here is what turns
  // that into a login screen rather than a page of broken panels.
  useEffect(() => {
    const onUnauthorized = () => utils.auth.status.invalidate();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [utils]);

  if (statusQuery.isLoading) {
    return <div className={styles.page} />;
  }

  // If the status query itself failed the server is unreachable or broken.
  // Falling through to the app is right: it will surface the real error, and
  // an auth failure here would be indistinguishable from a network one.
  const status = statusQuery.data;
  if (status?.required && !status.signedIn) {
    return <SignIn onSignedIn={() => utils.invalidate()} />;
  }

  return <>{children}</>;
}

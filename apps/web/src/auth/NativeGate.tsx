import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  getConnection,
  hideSplash,
  isNative,
  onDeepLink,
  onResume,
  saveMediaToken,
  subscribeConnection,
  watchLock,
} from "@tinkerbell/native-client";
import { trpc } from "#/trpc";
import ConnectServer from "./ConnectServer";
import LockScreen from "./LockScreen";
import styles from "./auth.module.css";

/**
 * What the native app needs before `AuthGate` can ask its first question.
 *
 * In a browser this renders its children and nothing else — the server that
 * served the page is the server, and the cookie is the session.
 *
 * In the app, in order: the lock screen if the app lock is on; the server
 * picker if no server is chosen (or a `tinkerbell://connect` link offered a
 * different one); then the ordinary `AuthGate`, whose sign-in screen knows to
 * use the in-app Plex flow.
 */
export default function NativeGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Back from the background: whatever is on screen refetches. Phone browsers
  // too — a tab woken after an hour shows data an hour old otherwise.
  useEffect(() => onResume(() => void queryClient.refetchQueries({ type: "active" })), [queryClient]);
  if (!isNative()) return <>{children}</>;
  return <NativeShell>{children}</NativeShell>;
}

function NativeShell({ children }: { children: ReactNode }) {
  const connection = useSyncExternalStore(subscribeConnection, getConnection);
  const [offered, setOffered] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      onDeepLink((link) => {
        // A link only *offers* a server; switching is the user's confirmation
        // on the picker. Any app on the phone can open one of these.
        if (link.kind === "connect") {
          if (link.server !== getConnection()?.server) setOffered(link.server);
        } else navigate(link.path);
      }),
    [navigate],
  );

  useEffect(() => {
    let stop: (() => void) | undefined;
    void watchLock(() => setLocked(true)).then((s) => (stop = s));
    return () => stop?.();
  }, []);

  // Everything cached belongs to the previous server. Only on a real change:
  // on mount this would wipe the link that cold-started the app.
  const server = connection?.server;
  const previous = useRef(server);
  useEffect(() => {
    if (previous.current === server) return;
    previous.current = server;
    queryClient.clear();
    setOffered(null);
  }, [server, queryClient]);

  // The splash stays up until there is a real screen to show: the server
  // picker or lock screen at once, the app once its session has settled
  // (NativeSession). Hiding it on mount showed a blank frame, then a skeleton.
  const settledScreen = locked || !connection || !!offered;
  useEffect(() => {
    if (settledScreen) hideSplash();
  }, [settledScreen]);

  if (locked) return <LockScreen onUnlocked={() => setLocked(false)} />;
  if (!connection || offered) return <ConnectServer key={offered ?? ""} initial={offered ?? ""} />;
  return <NativeSession key={connection.server}>{children}</NativeSession>;
}

/**
 * Inside the auth gate's decision: mints the media token every `<img>` needs
 * before the app renders one, and warns when the server has sign-in off.
 */
export function NativeSession({ children }: { children: ReactNode }) {
  const status = trpc.auth.status.useQuery(undefined, { staleTime: 0, retry: false });
  const mint = trpc.auth.mediaToken.useMutation();
  const signedIn = !!status.data?.signedIn;
  // Which sign-in state the media token was settled for. Signing in flips
  // `signedIn`, and the app must wait for the new token again.
  const [settledFor, setSettledFor] = useState<boolean | null>(null);
  const ready = settledFor === signedIn;

  // Fresh on every launch and sign-in rather than reused: it lives a day, and
  // an expired one fails as a page of broken posters with no error anywhere.
  useEffect(() => {
    if (!status.data) return;
    if (!signedIn) {
      setSettledFor(false);
      return;
    }
    let cancelled = false;
    mint
      .mutateAsync()
      .then(({ token }) => saveMediaToken(token))
      // Posters fail; nothing else does. Not worth blocking the app on.
      .catch(() => {})
      .finally(() => !cancelled && setSettledFor(true));
    return () => {
      cancelled = true;
    };
    // `mint` is a new object every render; the sign-in state is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, signedIn]);

  useEffect(() => {
    if (ready || status.isError) hideSplash();
  }, [ready, status.isError]);

  // An unreachable server still gets past this gate: AuthGate and the app
  // show the error, which is more useful than an endless blank screen.
  if (!ready && !status.isError) return <div className={styles.page} />;
  return <>{children}</>;
}

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  biometryAvailable,
  getConnection,
  getLockEnabled,
  hideSplash,
  isNative,
  onDeepLink,
  onResume,
  probeServer,
  saveServer,
  setLockEnabled,
  subscribeConnection,
  unlock,
  watchLock,
  type ServerCheck,
} from "@tinkerbell/native-client";

/**
 * The portal app's wrapper — the same steps as the admin app's `NativeGate`
 * (lock, then server, then the app), drawn in the portal's own styles because
 * the portal has no import path to the admin design system.
 *
 * In a browser it renders its children and nothing else.
 */
export default function NativeShell({ children }: { children: ReactNode }) {
  useEffect(hideSplash, []);
  const queryClient = useQueryClient();
  // Back from the background: what's on screen refetches.
  useEffect(() => onResume(() => void queryClient.refetchQueries({ type: "active" })), [queryClient]);
  if (!isNative()) return <>{children}</>;
  return <Shell>{children}</Shell>;
}

function Shell({ children }: { children: ReactNode }) {
  const connection = useSyncExternalStore(subscribeConnection, getConnection);
  const [offered, setOffered] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const queryClient = useQueryClient();

  // The portal is one screen, so `open` links have nowhere to go; only
  // `connect` means anything here. It offers a server, never switches one.
  useEffect(
    () =>
      onDeepLink((link) => {
        if (link.kind === "connect" && link.server !== getConnection()?.server) setOffered(link.server);
      }),
    [],
  );

  useEffect(() => {
    let stop: (() => void) | undefined;
    void watchLock(() => setLocked(true)).then((s) => (stop = s));
    return () => stop?.();
  }, []);

  const server = connection?.server;
  const previous = useRef(server);
  useEffect(() => {
    if (previous.current === server) return;
    previous.current = server;
    queryClient.clear();
    setOffered(null);
  }, [server, queryClient]);

  if (locked) return <Locked onUnlocked={() => setLocked(false)} />;
  if (!connection || offered) return <ConnectServer key={offered ?? ""} initial={offered ?? ""} />;
  return (
    <div key={connection.server}>
      {children}
      <AppFooter server={connection.server} />
    </div>
  );
}

function ConnectServer({ initial }: { initial: string }) {
  const [address, setAddress] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    const check = await probeServer(address, "tinkerbell-portal");
    setChecking(false);
    if (check.ok) await saveServer(check.server);
    else setError(explain(check));
  }

  return (
    <div className="page page-signin">
      <div className="card card-signin">
        <h1 className="brand">Tinkerbell</h1>
        <p className="lede">Enter the address your server's owner gave you, or scan the code they shared.</p>
        <form className="connect-form" onSubmit={connect}>
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://portal.example.com"
            aria-label="Server address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={checking || !address.trim()}>
            {checking ? "Checking…" : "Connect"}
          </button>
        </form>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function explain(check: Extract<ServerCheck, { ok: false }>): string {
  switch (check.reason) {
    case "wrong-app":
      return "That's the admin address. Ask the server's owner for the portal's address.";
    case "too-old":
      return `That server runs Tinkerbell ${check.detail}, which is too old for this app. Ask its owner to update.`;
    case "not-tinkerbell":
      return "Something answered at that address, but it isn't a Tinkerbell portal.";
    case "unreachable":
      return "Couldn't reach that address. Check it, and that the phone is online.";
  }
}

function Locked({ onUnlocked }: { onUnlocked: () => void }) {
  async function prompt() {
    if (await unlock("Unlock Tinkerbell")) onUnlocked();
  }
  useEffect(() => {
    void prompt();
    // Once per lock; a re-prompt is the button's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="page page-signin">
      <div className="card card-signin">
        <h1 className="brand">Tinkerbell</h1>
        <p className="lede">Locked.</p>
        <button type="button" className="btn-primary" onClick={prompt}>
          Unlock
        </button>
      </div>
    </div>
  );
}

/** The app's own settings, which belong to the phone rather than the server. */
function AppFooter({ server }: { server: string }) {
  const [available, setAvailable] = useState(false);
  const [lock, setLock] = useState(false);

  useEffect(() => {
    void biometryAvailable().then(setAvailable);
    void getLockEnabled().then(setLock);
  }, []);

  async function toggleLock() {
    const next = !lock;
    // Proving it works before relying on it: a lock you can't open is a lockout.
    if (next && !(await unlock("Turn on the app lock"))) return;
    await setLockEnabled(next);
    setLock(next);
  }

  return (
    <footer className="app-footer">
      <span>{new URL(server).host}</span>
      <button type="button" onClick={() => void saveServer(null)}>
        Switch server
      </button>
      {available && (
        <button type="button" onClick={() => void toggleLock()} aria-pressed={lock}>
          {lock ? "App lock on" : "App lock off"}
        </button>
      )}
    </footer>
  );
}

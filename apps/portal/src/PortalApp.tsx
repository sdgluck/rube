import { useEffect, useState } from "react";
import { portalTrpc } from "./trpc.ts";
import BrandHeader, { type Branding } from "./components/BrandHeader.tsx";
import SignIn from "./components/SignIn.tsx";
import { ErrorState, RowsSkeleton } from "./components/States.tsx";
import MyCollections from "./tabs/MyCollections.tsx";
import PreferencesForm from "./tabs/PreferencesForm.tsx";
import LeavingSoon from "./tabs/LeavingSoon.tsx";

/**
 * The portal shell: sign-in, branding, and which tab you are on.
 *
 * This file used to be the whole product — 656 lines holding the sign-in
 * screen, the tab bar and all three tabs, in the one surface end users
 * actually see. Everything below the tab bar now lives in `tabs/`, and the
 * pieces that were duplicated inline at five call sites (loading, empty,
 * error) are in `components/States.tsx`.
 */

const PIN_KEY = "tb_pin";

const TABS = [
  // "Your collections" is first on purpose: this was a form you filled in and
  // never heard back from, so what your answers produced should be the thing
  // you land on. "Leaving soon" is last because it is the one nobody wants to
  // be looking at.
  { id: "collections", label: "Your collections" },
  { id: "preferences", label: "Your tastes" },
  { id: "leaving", label: "Leaving soon" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function PortalApp() {
  const utils = portalTrpc.useUtils();
  const meQuery = portalTrpc.me.useQuery(undefined, { retry: false });
  const startMutation = portalTrpc.auth.start.useMutation();
  const pollMutation = portalTrpc.auth.poll.useMutation();
  const logoutMutation = portalTrpc.auth.logout.useMutation();
  const brandingQuery = portalTrpc.branding.useQuery();
  const branding: Branding = brandingQuery.data ?? {};
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("collections");
  const [finishing, setFinishing] = useState<boolean>(() => !!localStorage.getItem(PIN_KEY));

  // Apply the admin's background image to the page.
  useEffect(() => {
    const bg = branding.backgroundImage?.trim();
    const { style } = document.body;
    if (bg) {
      style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url("${bg}")`;
      style.backgroundSize = "cover";
      style.backgroundPosition = "center";
      style.backgroundAttachment = "fixed";
    } else {
      style.backgroundImage = "";
    }
    return () => {
      style.backgroundImage = "";
    };
  }, [branding.backgroundImage]);

  // After returning from Plex, finish the handshake by polling the pin.
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
          await utils.me.invalidate();
          return;
        }
      } catch (e) {
        localStorage.removeItem(PIN_KEY);
        setFinishing(false);
        setError(e instanceof Error ? e.message : "Sign-in failed.");
        return;
      }
      if (!cancelled && attempts < 60) setTimeout(tick, 2000);
      else {
        localStorage.removeItem(PIN_KEY);
        setFinishing(false);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
    // Run once on mount; the pin id is read from storage inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn() {
    setError(null);
    startMutation.mutate(
      { forwardUrl: window.location.origin },
      {
        onSuccess: ({ id, authUrl }) => {
          localStorage.setItem(PIN_KEY, String(id));
          window.location.href = authUrl;
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  if (meQuery.isLoading) {
    return (
      <div className="page">
        <div className="card">
          <RowsSkeleton rows={4} />
        </div>
      </div>
    );
  }

  // `me` failing with anything other than "not signed in" is a server the
  // portal cannot reach, and showing the sign-in screen for that sends people
  // round the Plex handshake to arrive back here.
  if (meQuery.error && meQuery.error.data?.code !== "UNAUTHORIZED") {
    return (
      <div className="page">
        <div className="card">
          <h1 className="title">
            <BrandHeader branding={branding} />
          </h1>
          <ErrorState message={meQuery.error.message} onRetry={() => meQuery.refetch()} />
        </div>
      </div>
    );
  }

  if (!meQuery.data) {
    return (
      <SignIn
        branding={branding}
        finishing={finishing}
        redirecting={startMutation.isPending}
        error={error}
        onSignIn={signIn}
      />
    );
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row-between">
          <h1 className="title">
            <BrandHeader branding={branding} />
          </h1>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => logoutMutation.mutate(undefined, { onSuccess: () => utils.me.reset() })}
          >
            Sign out ({meQuery.data.username})
          </button>
        </div>

        <div className="tabs" role="tablist" aria-label="Portal sections">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab ${tab === id ? "tab-on" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "collections" ? <MyCollections /> : tab === "preferences" ? <PreferencesForm /> : <LeavingSoon />}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock, Heart, LayoutGrid, Popcorn, UserRound, type LucideIcon } from "lucide-react";
import { useIsPhone } from "./useIsPhone.ts";
import { portalTrpc } from "./trpc.ts";
import BrandHeader, { type Branding } from "./components/BrandHeader.tsx";
import SignIn from "./components/SignIn.tsx";
import { EmptyState, ErrorState, RowsSkeleton } from "./components/States.tsx";
import MyCollections from "./tabs/MyCollections.tsx";
import PreferencesForm from "./tabs/PreferencesForm.tsx";
import LeavingSoon from "./tabs/LeavingSoon.tsx";
import MatchTab from "./match/MatchTab.tsx";
import GuestMatch from "./match/GuestMatch.tsx";
import { guestToken, rememberLinkAcrossSignIn, setActiveGuest, takePendingLink } from "./match/link.ts";
import { useMatchRoute } from "./match/route.ts";

/**
 * The portal shell: sign-in, branding, and which tab you are on.
 *
 * This file used to be the whole product — 656 lines holding the sign-in
 * screen, the tab bar and all three tabs, in the one surface end users
 * actually see. Everything below the tab bar now lives in `tabs/`, and the
 * pieces that were duplicated inline at five call sites (loading, empty,
 * error) are in `components/States.tsx`.
 */

/**
 * Signing in leaves the page entirely — Plex takes over the tab and sends the
 * browser back afterwards — so nothing in React state survives the round trip.
 * This flag is the reminder to resume polling on the way back.
 *
 * It is only a flag. The handshake itself lives in an HttpOnly cookie the
 * server set when the flow began, which is what ties the sign-in to this
 * browser. This used to hold the plex.tv PIN id and send it back to `poll`,
 * which meant the server accepted whichever id a caller presented.
 */
const PENDING_KEY = "tb_portal_signin_pending";

const TABS = [
  // "Your tastes" is first: it is the one thing here only you can do, and
  // your collections are empty until you have done it. "Your collections"
  // follows so what your answers produced is one tap away. "Leaving soon" is
  // last because it is the one nobody wants to be looking at.
  // Each behind the admin's switch for it (Settings → Portal → Components),
  // and Leaving soon behind cleanup being on as well — it used to show on
  // servers that could never remove anything, saying so forever.
  { id: "preferences", label: "Your tastes", component: "tab.tastes" },
  { id: "collections", label: "Your collections", component: "tab.collections" },
  { id: "match", label: "Movie match", component: "tab.match" },
  { id: "leaving", label: "Leaving soon", component: "tab.leaving" },
] as const;

type TabId = (typeof TABS)[number]["id"] | "account";

/** The tab bar's icons and short labels, on a phone. */
const PHONE_TABS: Record<TabId, { label: string; Icon: LucideIcon }> = {
  preferences: { label: "Tastes", Icon: Heart },
  collections: { label: "Collections", Icon: LayoutGrid },
  match: { label: "Match", Icon: Popcorn },
  leaving: { label: "Leaving", Icon: Clock },
  account: { label: "Account", Icon: UserRound },
};

function tabFromHash(): TabId | null {
  // `#match/CODE` is still the match tab; see match/link.ts.
  const id = location.hash.slice(1).split("/")[0] ?? "";
  return id in PHONE_TABS ? (id as TabId) : null;
}

export default function PortalApp() {
  const utils = portalTrpc.useUtils();
  const meQuery = portalTrpc.me.useQuery(undefined, { retry: false });
  const startMutation = portalTrpc.auth.start.useMutation();
  const pollMutation = portalTrpc.auth.poll.useMutation();
  const logoutMutation = portalTrpc.auth.logout.useMutation();
  const brandingQuery = portalTrpc.branding.useQuery();
  const componentsQuery = portalTrpc.components.useQuery(undefined, { enabled: !!meQuery.data });
  const branding: Branding = brandingQuery.data ?? {};
  const [error, setError] = useState<string | null>(null);
  const isPhone = useIsPhone();
  const [tab, setTabState] = useState<TabId>(() => tabFromHash() ?? "preferences");
  const scrollByTab = useRef(new Map<TabId, number>());

  /**
   * On a phone each tab is a history entry, so Back (Android's key, a browser
   * gesture) goes to the previous tab and, from the first, leaves — and each
   * tab comes back where it was scrolled to. On a desktop it is plain state,
   * as it always was.
   */
  const setTab = (next: TabId) => {
    if (next === tab) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    scrollByTab.current.set(tab, window.scrollY);
    if (isPhone) {
      history.pushState({ ...history.state, portalTab: next }, "", `#${next}`);
    }
    setTabState(next);
  };
  useEffect(() => {
    const onPop = () => {
      scrollByTab.current.set(tab, window.scrollY);
      setTabState(tabFromHash() ?? "preferences");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [tab]);
  useEffect(() => {
    window.scrollTo(0, scrollByTab.current.get(tab) ?? 0);
  }, [tab]);
  const [finishing, setFinishing] = useState<boolean>(() => !!localStorage.getItem(PENDING_KEY));
  const matchRoute = useMatchRoute();

  // Back from plex.tv with an invite link that was open when sign-in began:
  // put it back, so the room it was for opens rather than the default tab.
  const signedIn = !!meQuery.data;
  useEffect(() => {
    if (!signedIn) return;
    setActiveGuest(null);
    const pending = takePendingLink();
    if (pending) {
      history.replaceState(history.state, "", pending);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      setTabState("match");
    }
  }, [signedIn]);

  // Apply the admin's background image to the page. It is painted by a fixed
  // `body::before` (portal.css) rather than `background-attachment: fixed` on
  // the body, which iOS Safari ignores — it sized the image against the whole
  // scroll height, so a phone showed a blurry, hugely zoomed-in crop of it.
  useEffect(() => {
    const bg = branding.backgroundImage?.trim();
    const { style } = document.body;
    if (bg) {
      style.setProperty("--page-image", `linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.45)), url("${bg}")`);
    } else {
      style.removeProperty("--page-image");
    }
    return () => {
      style.removeProperty("--page-image");
    };
  }, [branding.backgroundImage]);

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
          await utils.me.invalidate();
          return;
        }
        if (res.status === "expired") {
          // The handshake cookie is gone or too old — nothing to finish.
          stop();
          setError("That sign-in took too long. Try again.");
          return;
        }
      } catch (e) {
        stop();
        setError(e instanceof Error ? e.message : "Sign-in failed.");
        return;
      }
      if (!cancelled && attempts < 60) setTimeout(tick, 2000);
      else stop();
    };
    tick();
    return () => {
      cancelled = true;
    };
    // Run once on mount; the pending flag is read from storage inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function signIn() {
    setError(null);
    rememberLinkAcrossSignIn();
    startMutation.mutate(undefined, {
      onSuccess: ({ authUrl }) => {
        localStorage.setItem(PENDING_KEY, "1");
        window.location.href = authUrl;
      },
      onError: (e) => setError(e.message),
    });
  }

  if (meQuery.isLoading || (meQuery.data && componentsQuery.isLoading)) {
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

  // A room's invite link, opened by someone who isn't signed in: the room's
  // guest screen rather than the sign-in one. Most people sent a link like
  // this have no account on this server to sign in with.
  if (!meQuery.data && matchRoute?.code && (matchRoute.invite || guestToken(matchRoute.code))) {
    return (
      <GuestMatch
        key={matchRoute.code}
        code={matchRoute.code}
        invite={matchRoute.invite}
        branding={branding}
        onSignIn={signIn}
      />
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

  if (componentsQuery.error) {
    return (
      <div className="page">
        <div className="card">
          <ErrorState message={componentsQuery.error.message} onRetry={() => componentsQuery.refetch()} />
        </div>
      </div>
    );
  }

  const components = componentsQuery.data!;
  const tabs = TABS.filter((t) => components[t.component]);
  // The remembered tab can be one the admin has since switched off.
  const current: TabId | undefined =
    tab === "account" && isPhone ? "account" : (tabs.find((t) => t.id === tab)?.id ?? tabs[0]?.id);

  const signOut = () =>
    logoutMutation.mutate(undefined, {
      onSuccess: () => utils.me.reset(),
    });

  const content: ReactNode =
    current === "collections" ? (
      <MyCollections
        components={components}
        onSetTastes={components["tab.tastes"] ? () => setTab("preferences") : undefined}
      />
    ) : current === "preferences" ? (
      <PreferencesForm components={components} />
    ) : current === "match" ? (
      <MatchTab />
    ) : current === "leaving" ? (
      <LeavingSoon components={components} />
    ) : current === "account" ? (
      <Account username={meQuery.data.username} onSignOut={signOut} signingOut={logoutMutation.isPending} />
    ) : (
      <EmptyState title="Nothing here yet">The server's owner hasn't turned anything on for you.</EmptyState>
    );

  /**
   * The phone layout: a sticky header, the screen under its heading, and a
   * bottom tab bar with icons — Account last, holding what the desktop's
   * header does. Full-width rather than a card floating on a page, which
   * wastes a 390px screen on gutters. A plain responsive page, not an
   * imitation of either platform's app.
   */
  if (isPhone) {
    const phoneTabs: TabId[] = [...tabs.map((t) => t.id), "account"];
    return (
      <div className="phone-app">
        <header className="phone-header">
          <span className="phone-brand">
            <BrandHeader branding={branding} />
          </span>
        </header>
        <main className="phone-screen">
          <h1 className="screen-title">{PHONE_TABS[current ?? "account"].label}</h1>
          {content}
        </main>
        <nav className="tab-bar" aria-label="Portal sections">
          {phoneTabs.map((id) => {
            const { label, Icon } = PHONE_TABS[id];
            const on = current === id;
            return (
              <button
                key={id}
                type="button"
                className={`tab-bar-item ${on ? "on" : ""}`}
                aria-current={on ? "page" : undefined}
                onClick={() => setTab(id)}
              >
                <Icon className="tab-bar-icon" size={24} strokeWidth={2} aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row-between">
          <h1 className="title">
            <BrandHeader branding={branding} />
          </h1>
          <button type="button" className="btn-ghost btn-signout" onClick={signOut}>
            Sign out <span className="signout-user">({meQuery.data.username})</span>
          </button>
        </div>

        {/* One tab is no choice at all, so the bar only appears for two. */}
        {tabs.length > 1 && (
          <div
            className="tabs"
            role="tablist"
            aria-label="Portal sections"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
          >
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={current === id}
                className={`tab ${current === id ? "tab-on" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {content}
      </div>
    </div>
  );
}

/**
 * The phone's Account tab: who you are, and signing out — the things that
 * belong to the person rather than to their tastes. Signing out is one tap,
 * as the desktop's header button is: it used to raise an action sheet to
 * confirm, and the way back in is a sign-in, not anything lost.
 */
function Account({
  username,
  onSignOut,
  signingOut,
}: {
  username: string;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <div className="stack">
      <div className="list-group">
        <div className="list-row">
          <span>Plex account</span>
          <span className="muted">{username}</span>
        </div>
      </div>
      <div className="list-group">
        <button type="button" className="list-row list-button danger" onClick={onSignOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}

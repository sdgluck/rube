import { useEffect, useState } from "react";
import { describeMatchFilters } from "@tinkerbell/contracts";
import { portalTrpc } from "../trpc.ts";
import BrandHeader, { type Branding } from "../components/BrandHeader.tsx";
import { EmptyState, ErrorState, RowsSkeleton } from "../components/States.tsx";
import Room from "./Room.tsx";
import { guestToken, saveGuestToken, setActiveGuest } from "./link.ts";
import { settleOnRoom } from "./route.ts";
import "./match.css";

/**
 * Somebody who opened a room's invite link without signing in — most likely
 * someone with no account on this server at all. They get the room and
 * nothing else: a name, a token for this one room (kept on this device), and a
 * way to sign in with Plex instead if they do have an account here.
 */
export default function GuestMatch({
  code,
  invite,
  branding,
  onSignIn,
}: {
  code: string;
  invite: string | null;
  branding: Branding;
  onSignIn: () => void;
}) {
  const [token, setToken] = useState(() => guestToken(code));
  const [left, setLeft] = useState(false);

  // Set during render, not in an effect: the room's queries start in its own
  // effects, which run before this component's, and would go out without it.
  setActiveGuest(token);
  useEffect(() => () => setActiveGuest(null), []);

  if (left) {
    return (
      <Shell branding={branding}>
        <p className="state-title">You've left the room.</p>
        <p className="muted">Open the invite link again to rejoin.</p>
      </Shell>
    );
  }

  if (token) {
    return (
      <div className="page mm-guest-page">
        <div className="card mm-guest-card">
          <Room
            code={code}
            onLeft={() => {
              saveGuestToken(code, null);
              setToken(null);
              setLeft(true);
            }}
          />
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <Shell branding={branding}>
        <p className="lede">
          To join room {code}, open the invite link whoever made it sent you — or sign in if you're on this server.
        </p>
        <button type="button" className="btn-plex" onClick={onSignIn}>
          Sign in with Plex
        </button>
      </Shell>
    );
  }

  return (
    <JoinForm
      code={code}
      invite={invite}
      branding={branding}
      onSignIn={onSignIn}
      onJoined={(t) => {
        saveGuestToken(code, t);
        setToken(t);
        settleOnRoom(code);
      }}
    />
  );
}

function JoinForm({
  code,
  invite,
  branding,
  onSignIn,
  onJoined,
}: {
  code: string;
  invite: string;
  branding: Branding;
  onSignIn: () => void;
  onJoined: (token: string) => void;
}) {
  const previewQuery = portalTrpc.match.guest.preview.useQuery({ code, invite }, { retry: false });
  const joinMutation = portalTrpc.match.guest.join.useMutation();
  const [name, setName] = useState("");

  if (previewQuery.isLoading) {
    return (
      <Shell branding={branding}>
        <RowsSkeleton rows={2} />
      </Shell>
    );
  }
  if (previewQuery.error || !previewQuery.data) {
    // A dead link is the likely case, and it isn't a failure to load.
    const gone = previewQuery.error?.data?.code === "NOT_FOUND";
    return (
      <Shell branding={branding}>
        {gone ? (
          <EmptyState title="This invite doesn't work any more">
            The room has closed, or the link is incomplete. Ask whoever sent it for a new one.
          </EmptyState>
        ) : (
          <ErrorState message={previewQuery.error?.message} onRetry={() => previewQuery.refetch()} />
        )}
      </Shell>
    );
  }

  const room = previewQuery.data;
  const pills = describeMatchFilters(room.filters);
  return (
    <Shell branding={branding}>
      <p className="lede">
        {room.members.join(", ")} {room.members.length === 1 ? "is" : "are"} picking a film from {room.library}
        {pills.length ? ` (${pills.join(", ")})` : ""}. Join them: swipe right on what you'd watch, left on what you
        wouldn't.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          joinMutation.mutate({ code, invite, name }, { onSuccess: (r) => onJoined(r.token) });
        }}
      >
        <label className="field">
          <span className="field-label">Your name</span>
          <input type="text" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
          <span className="field-hint">What the others will see. No account needed.</span>
        </label>
        <button type="submit" className="btn-primary" disabled={!name.trim() || joinMutation.isPending}>
          Join room {code}
        </button>
        {joinMutation.error && <p className="err">{joinMutation.error.message}</p>}
      </form>
      <p className="reassurance">
        On this Plex server?{" "}
        <button type="button" className="btn-ghost mm-inline-button" onClick={onSignIn}>
          Sign in instead
        </button>
      </p>
    </Shell>
  );
}

function Shell({ branding, children }: { branding: Branding; children: React.ReactNode }) {
  return (
    <div className="page page-signin">
      <div className="card card-signin">
        <h1 className="brand">
          <BrandHeader branding={branding} size={32} />
        </h1>
        <h2 className="mm-heading">Movie night</h2>
        {children}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { portalTrpc } from "../trpc.ts";
import { EmptyState, RowsSkeleton } from "../components/States.tsx";
import Lobby from "./Lobby.tsx";
import Room from "./Room.tsx";
import { goToLobby, goToRoom, settleOnRoom, useMatchRoute } from "./route.ts";
import "./match.css";

/** The Movie match tab, for a signed-in user of this server. Guests get `GuestMatch` instead. */
export default function MatchTab() {
  const route = useMatchRoute();
  if (!route?.code) return <Lobby onOpen={goToRoom} />;
  return <JoinedRoom key={route.code} code={route.code} invite={route.invite} />;
}

/**
 * Joins before showing the room. Joining is idempotent, so opening a room
 * you're already in costs one cheap call, and a link from someone else
 * (with or without its invite secret) lands you in it.
 */
function JoinedRoom({ code, invite }: { code: string; invite: string | null }) {
  const joinMutation = portalTrpc.match.join.useMutation();
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    joinMutation.mutate(
      { code, ...(invite ? { invite } : {}) },
      {
        onSuccess: () => {
          setJoined(true);
          if (invite) settleOnRoom(code);
        },
      },
    );
    // Once per room; the secret is dropped from the URL after it has worked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (joinMutation.error) {
    return (
      <EmptyState
        title="Couldn't open that room"
        action={
          <button type="button" onClick={goToLobby}>
            Back to movie match
          </button>
        }
      >
        {joinMutation.error.message}
      </EmptyState>
    );
  }
  if (!joined) return <RowsSkeleton rows={4} />;
  return <Room code={code} onBack={goToLobby} onLeft={goToLobby} />;
}

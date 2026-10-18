import { useState } from "react";
import { trpc } from "#/trpc";
import EmptyState from "#components/EmptyState";
import ErrorState from "#components/ErrorState";
import Modal from "#components/Modal";
import { SkeletonTable } from "#components/Skeleton";
import { useToast } from "#components/Toast";
import shared from "#/styles/shared.module.css";
import { useUserDetail } from "./context.ts";
import local from "./UserDetail.module.css";

/** Shown on the viewer's own screen, so it has to read as a message to a person. */
const DEFAULT_REASON = "Your stream was stopped by the server owner.";

export default function Sessions() {
  const { userId } = useUserDetail();
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const [terminating, setTerminating] = useState<{ sessionId: string; title: string } | null>(null);
  const [reason, setReason] = useState(DEFAULT_REASON);

  const query = trpc.users.sessions.useQuery({ userId }, { refetchInterval: 10_000 });
  const terminate = trpc.users.terminateSession.useMutation();

  if (query.isLoading) return <SkeletonTable />;
  if (query.error) {
    return <ErrorState title="Couldn't load sessions" error={query.error} onRetry={() => query.refetch()} />;
  }

  const sessions = query.data ?? [];
  if (sessions.length === 0) {
    return <EmptyState icon="monitor" title="Not watching anything" />;
  }

  return (
    <>
      <div className="table-scroll">
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Playing</th>
              <th>Player</th>
              <th>Stream</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.sessionKey ?? session.sessionId}>
                <td>
                  {session.grandparentTitle ? `${session.grandparentTitle} — ${session.title}` : session.title}
                  <span className={local.dim}> · {session.state}</span>
                </td>
                <td className={local.dim}>
                  {session.player}
                  {session.platform ? ` · ${session.platform}` : ""}
                </td>
                <td className={local.dim}>
                  {session.decision}
                  {session.videoResolution ? ` · ${session.videoResolution}` : ""}
                </td>
                <td>
                  {/* Plex identifies a terminable stream by `Session.id`, which
                      older servers omit. Without it there is nothing to send,
                      so the button says why rather than failing on click. */}
                  <button
                    type="button"
                    className={shared.buttonDanger}
                    disabled={!session.sessionId}
                    title={session.sessionId ? "Stop this stream" : "This Plex server didn't report a session id"}
                    onClick={() => {
                      setReason(DEFAULT_REASON);
                      setTerminating({ sessionId: session.sessionId!, title: session.title });
                    }}
                  >
                    Terminate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {terminating && (
        <Modal
          open
          onClose={() => setTerminating(null)}
          size="sm"
          title={`Stop "${terminating.title}"?`}
          dismissOnBackdrop={false}
          footer={
            <>
              <button type="button" className={shared.buttonSecondary} onClick={() => setTerminating(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={shared.buttonDanger}
                disabled={terminate.isPending}
                onClick={async () => {
                  try {
                    await terminate.mutateAsync({ sessionId: terminating.sessionId, reason });
                    setTerminating(null);
                    utils.users.sessions.invalidate({ userId });
                    addToast("Stream stopped", "success");
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : "Failed to stop the stream", "error");
                  }
                }}
              >
                {terminate.isPending ? "Stopping…" : "Stop stream"}
              </button>
            </>
          }
        >
          <label htmlFor="terminate-reason" className={local.panelHint}>
            Plex shows this message on the player.
          </label>
          <input
            id="terminate-reason"
            type="text"
            autoFocus
            maxLength={200}
            className={shared.labelEditorInput}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Modal>
      )}
    </>
  );
}

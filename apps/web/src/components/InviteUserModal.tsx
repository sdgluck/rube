import { useState } from "react";
import Modal from "./Modal";
import { trpc } from "#/trpc";
import { useToast } from "./Toast";
import shared from "#/styles/shared.module.css";
import styles from "./InviteUserModal.module.css";

interface Props {
  onClose: () => void;
  onInvited: () => void;
}

/**
 * Share the server with someone by email.
 *
 * Plex sends the invite itself; there is nothing to resend from here and no
 * way to know when it is accepted other than the next users sync, so the
 * dialog closes on a successful POST and the row shows up as pending.
 */
export default function InviteUserModal({ onClose, onInvited }: Props) {
  const { addToast } = useToast();
  const [email, setEmail] = useState("");
  const [sections, setSections] = useState<Set<string>>(new Set());
  const [allowSync, setAllowSync] = useState(false);
  const [allowTuners, setAllowTuners] = useState(false);

  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false });
  const available = sectionsQuery.data ?? [];

  const invite = trpc.users.invite.useMutation({
    onSuccess: () => {
      addToast(`Invited ${email}`, "success");
      onInvited();
    },
    onError: (err) => addToast(err.message || "Failed to send the invite", "error"),
  });

  const toggle = (key: string) => {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canSubmit = email.trim().length > 0 && !invite.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Invite a user"
      footer={
        <>
          <button type="button" className={shared.buttonSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={shared.button}
            disabled={!canSubmit}
            onClick={() =>
              invite.mutate({
                email: email.trim(),
                librarySectionIds: [...sections].map(Number),
                settings: { allowSync, allowTuners },
              })
            }
          >
            {invite.isPending ? "Inviting…" : "Send invite"}
          </button>
        </>
      }
    >
      <div className={shared.labelEditorRow}>
        <label htmlFor="invite-email">Plex account email</label>
        <input
          id="invite-email"
          type="email"
          autoFocus
          autoComplete="off"
          placeholder="them@example.com"
          className={shared.labelEditorInput}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Libraries</legend>
        {/* Plex's own convention: an empty selection shares everything, which
            is also what most people mean by "invite a friend". */}
        <p className={styles.hint}>Leave everything unticked to share all libraries.</p>
        <div className={shared.labelCheckboxList}>
          {available.map((section) => (
            <label key={section.key} className={shared.labelCheckboxItem}>
              <input type="checkbox" checked={sections.has(section.key)} onChange={() => toggle(section.key)} />
              {section.title}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Permissions</legend>
        <label className={shared.labelCheckboxItem}>
          <input type="checkbox" checked={allowSync} onChange={(e) => setAllowSync(e.target.checked)} />
          Allow downloads
        </label>
        <label className={shared.labelCheckboxItem}>
          <input type="checkbox" checked={allowTuners} onChange={(e) => setAllowTuners(e.target.checked)} />
          Allow Live TV &amp; DVR
        </label>
      </fieldset>
    </Modal>
  );
}

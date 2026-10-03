import { useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import SettingsPageLink from "#components/SettingsPageLink";
import { useToast } from "#components/Toast";
import styles from "./MediaEditPanel.module.css";

/**
 * Editing one item's metadata by hand.
 *
 * Opened from the page's action bar, which is where the item's other verbs
 * live — a third button in its own style halfway down the page would read as
 * a different kind of thing.
 *
 *
 * The smallest useful version of the feature, and the one people find first —
 * which is why the lock explanation lives here in plain words rather than in a
 * tooltip. A locked field stops receiving updates from Plex's metadata agents;
 * an unlocked one may be quietly reverted by the next refresh. Both are real
 * choices and the panel says which it is about to make.
 *
 * Unlocking is as prominent as saving. Being unable to hand a field back would
 * make every edit a one-way door, which is the thing that stops people trying
 * this at all.
 */
const FIELDS = [
  { key: "title", label: "Title", multiline: false },
  { key: "titleSort", label: "Sort title", multiline: false },
  { key: "tagline", label: "Tagline", multiline: false },
  { key: "summary", label: "Summary", multiline: true },
  { key: "contentRating", label: "Content rating", multiline: false },
  { key: "studio", label: "Studio", multiline: false },
  { key: "originallyAvailableAt", label: "Originally available", multiline: false },
  { key: "year", label: "Year", multiline: false },
] as const;

/** Only the fields the client knows how to write. */
type EditableField = (typeof FIELDS)[number]["key"];

/**
 * The tag sets Plex will accept a write to.
 *
 * `updateFields` has taken these since the day it shipped and nothing ever
 * sent one, so genres and labels — the two things a curation tool exists to
 * change — could be read on this page and edited only in Plex.
 *
 * Comma-separated text rather than a chip editor: a tag set is short, the
 * value is already a list everywhere else in the app, and a first version that
 * can be typed into beats a better one that doesn't exist.
 */
const TAG_FIELDS = [
  { key: "genre", label: "Genres" },
  { key: "label", label: "Labels" },
  { key: "collection", label: "Collections" },
  { key: "director", label: "Directors" },
  { key: "writer", label: "Writers" },
] as const;

type EditableTagField = (typeof TAG_FIELDS)[number]["key"];

const splitTags = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

export default function MediaEditPanel({ ratingKey, onClose }: { ratingKey: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});
  const [lock, setLock] = useState(true);
  const [saving, setSaving] = useState(false);

  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const fieldsQuery = trpc.metadata.fields.useQuery({ ratingKey }, { refetchOnWindowFocus: false });
  const updateMutation = trpc.metadata.updateFields.useMutation();
  const unlockMutation = trpc.metadata.unlockFields.useMutation();

  const current = fieldsQuery.data;

  useEffect(() => {
    if (!current) return;
    const next: Record<string, string> = {};
    for (const { key } of FIELDS) next[key] = (current.fields as Record<string, string>)[key] ?? "";
    setDraft(next);
    const nextTags: Record<string, string> = {};
    for (const { key } of TAG_FIELDS) {
      nextTags[key] = ((current.tags as Record<string, string[]>)[key] ?? []).join(", ");
    }
    setTagDraft(nextTags);
  }, [current]);

  const changed = useMemo(() => {
    if (!current) return [] as EditableField[];
    return FIELDS.map((f) => f.key).filter(
      (key) => draft[key] !== ((current.fields as Record<string, string>)[key] ?? ""),
    );
  }, [draft, current]);

  const changedTags = useMemo(() => {
    if (!current) return [] as EditableTagField[];
    return TAG_FIELDS.map((f) => f.key).filter(
      (key) => !sameTags(splitTags(tagDraft[key] ?? ""), (current.tags as Record<string, string[]>)[key] ?? []),
    );
  }, [tagDraft, current]);

  const totalChanged = changed.length + changedTags.length;

  const lockedFields = new Set(current?.locked ?? []);

  const handleSave = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const fields = Object.fromEntries(changed.map((key) => [key, draft[key]]));
      const tags = Object.fromEntries(changedTags.map((key) => [key, splitTags(tagDraft[key] ?? "")]));
      const result = await updateMutation.mutateAsync({ ratingKey, fields, tags, lock });
      addToast(
        result.writes === 0
          ? "Nothing to change"
          : `Saved ${result.writes} field${result.writes === 1 ? "" : "s"}${lock ? " and locked them" : ""}`,
        "success",
      );
      await Promise.all([
        utils.metadata.fields.invalidate({ ratingKey }),
        utils.media.get.invalidate({ ratingKey }),
        // The detail page lists this item's write history right below.
        utils.metadata.history.invalidate({ ratingKey }),
      ]);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleUnlock = async (field: string) => {
    try {
      await unlockMutation.mutateAsync({ ratingKey, fields: [field] });
      addToast(`${field} handed back to Plex`, "success");
      await utils.metadata.fields.invalidate({ ratingKey });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to unlock", "error");
    }
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Edit metadata</h3>
        <button className={styles.close} onClick={onClose}>
          Close
        </button>
      </div>

      {fieldsQuery.isLoading && <p className={styles.hint}>Reading the current values from Plex…</p>}
      {fieldsQuery.error && <p className={styles.error}>Could not read this item's fields from Plex.</p>}

      {current && (
        <>
          <div className={styles.fields}>
            {FIELDS.map(({ key, label, multiline }) => (
              <div key={key} className={styles.field}>
                <div className={styles.fieldHead}>
                  <label className={styles.label} htmlFor={`meta-${key}`}>
                    {label}
                  </label>
                  {lockedFields.has(key) && (
                    <button
                      className={styles.unlock}
                      onClick={() => handleUnlock(key)}
                      disabled={unlockMutation.isPending}
                      title="Hand this field back to Plex"
                    >
                      <LockIcon /> Unlock
                    </button>
                  )}
                </div>
                {multiline ? (
                  <textarea
                    id={`meta-${key}`}
                    className={styles.summaryInput}
                    rows={4}
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  />
                ) : (
                  <input
                    id={`meta-${key}`}
                    className={styles.textInput}
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            {TAG_FIELDS.map(({ key, label }) => (
              <div key={key} className={styles.field}>
                <div className={styles.fieldHead}>
                  <label className={styles.label} htmlFor={`meta-tag-${key}`}>
                    {label}
                  </label>
                  {lockedFields.has(key) && (
                    <button
                      className={styles.unlock}
                      onClick={() => handleUnlock(key)}
                      disabled={unlockMutation.isPending}
                      title="Hand this field back to Plex"
                    >
                      <LockIcon /> Unlock
                    </button>
                  )}
                </div>
                <input
                  id={`meta-tag-${key}`}
                  className={styles.textInput}
                  value={tagDraft[key] ?? ""}
                  placeholder="Comma separated"
                  onChange={(e) => setTagDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <label className={styles.lockRow}>
            <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
            <span>
              <span className={styles.lockLabel}>Lock what I change</span>
              <span className={styles.lockHint}>Stops Plex overwriting your edits.</span>
            </span>
          </label>

          <div className={styles.actions}>
            <button className={styles.save} onClick={handleSave} disabled={totalChanged === 0 || saving}>
              {saving
                ? "Saving…"
                : totalChanged === 0
                  ? "Save"
                  : `Save ${totalChanged} change${totalChanged === 1 ? "" : "s"}`}
            </button>
            <span className={styles.hint}>
              Revertible from <SettingsPageLink to="/settings/metadata" />
            </span>
          </div>
        </>
      )}
    </section>
  );
}

/** Marks a field Plex's agents won't touch; the button beside it releases it. */
function LockIcon() {
  return (
    <svg
      className={styles.lockIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

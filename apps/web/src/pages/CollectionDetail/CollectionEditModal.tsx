import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "#/trpc";
import Modal from "#components/Modal";
import { useToast } from "#components/Toast";
import shared from "#/styles/shared.module.css";
import styles from "./CollectionEditModal.module.css";

/** Labels Tinkerbell writes itself, which read as provenance rather than tags. */
const SYSTEM_LABELS = ["tinkerbell", "generated", "becauseyouwatched"];

/**
 * `Rule:<uuid>` is how a rule finds its own collections again. It is plumbing —
 * nobody typed it, and removing it would quietly orphan the collection from its
 * rule. Hidden from the editor, not from the record: it is carried through the
 * save untouched, so editing the labels you *can* see never drops it.
 */
const isPlumbingLabel = (label: string) => label.startsWith("Rule:");

const STEPS = [
  { id: "details", label: "Details" },
  { id: "labels", label: "Labels" },
  { id: "review", label: "Review" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

interface Props {
  ratingKey: string;
  title: string;
  summary: string;
  labels: string[];
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY = "—";

/**
 * The one place a collection's name, summary and labels are edited.
 *
 * They used to be edited in place at the top of the page — an inline title
 * input, an always-open textarea and a label field that only appeared on
 * hover. Three different edit idioms in one header, none of which announced
 * itself, and a sticky save bar that appeared from off-screen to commit two of
 * the three. The page header is now presentation; this is the form.
 */
export default function CollectionEditModal({ ratingKey, title, summary, labels, onClose, onSaved }: Props) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const [stepIdx, setStepIdx] = useState(0);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftSummary, setDraftSummary] = useState(summary);
  const [draftLabels, setDraftLabels] = useState(() => labels.filter((l) => !isPlumbingLabel(l)));
  const [labelInput, setLabelInput] = useState("");
  const [saving, setSaving] = useState(false);

  const updateMutation = trpc.collections.update.useMutation();
  const updateLabelsMutation = trpc.collections.updateLabels.useMutation();

  const step = STEPS[stepIdx];
  const isLastStep = stepIdx === STEPS.length - 1;
  const trimmedTitle = draftTitle.trim();

  const labelsChanged = useMemo(() => {
    const before = labels.filter((l) => !isPlumbingLabel(l));
    return before.length !== draftLabels.length || before.some((l, i) => l !== draftLabels[i]);
  }, [labels, draftLabels]);

  const detailsChanged = trimmedTitle !== title || draftSummary !== summary;

  const addLabel = () => {
    const value = labelInput.trim();
    if (!value) return;
    setLabelInput("");
    setDraftLabels((prev) => (prev.some((l) => l.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]));
  };

  const save = useCallback(async () => {
    if (!trimmedTitle) return;
    setSaving(true);
    try {
      if (detailsChanged) {
        await updateMutation.mutateAsync({
          ratingKey,
          title: trimmedTitle,
          summary: draftSummary,
        });
      }
      if (labelsChanged) {
        // The plumbing labels never appeared in the editor, so they are put
        // back here rather than being silently dropped by the round trip.
        const plumbing = labels.filter(isPlumbingLabel);
        await updateLabelsMutation.mutateAsync({
          ratingKey,
          labels: [...draftLabels, ...plumbing],
        });
      }
      utils.collections.get.invalidate({ ratingKey });
      addToast(detailsChanged || labelsChanged ? "Collection updated" : "Nothing to save", "success");
      onSaved();
    } catch {
      addToast("Failed to update the collection", "error");
    } finally {
      setSaving(false);
    }
  }, [
    trimmedTitle,
    detailsChanged,
    labelsChanged,
    draftSummary,
    draftLabels,
    labels,
    ratingKey,
    updateMutation,
    updateLabelsMutation,
    utils,
    addToast,
    onSaved,
  ]);

  const goNext = useCallback(() => {
    if (isLastStep) {
      save();
      return;
    }
    setStepIdx((i) => i + 1);
  }, [isLastStep, save]);

  // Enter advances a step, as it does in the rule wizard. A button owns its own
  // Enter, a textarea owns the newline, and the label field owns it because
  // adding a label is what Enter means while you are standing in it. Escape is
  // handled by <Modal>.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "TEXTAREA" || tag === "BUTTON" || el?.dataset.ownsEnter === "true") return;
      e.preventDefault();
      goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext]);

  const labelClass = (label: string) =>
    SYSTEM_LABELS.includes(label.toLowerCase())
      ? shared.labelTinkerbell
      : label.toLowerCase().startsWith("user:")
        ? shared.labelUser
        : "";

  const jumpTo = (id: StepId) => setStepIdx(STEPS.findIndex((s) => s.id === id));

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit "${title}"`}
      size="lg"
      dismissOnBackdrop={false}
      footer={
        <>
          <div className={styles.footerLeft}>
            <button type="button" className={shared.buttonSecondary} onClick={onClose}>
              Cancel
            </button>
          </div>
          <div className={styles.footerRight}>
            {stepIdx > 0 && (
              <button type="button" className={shared.buttonSecondary} onClick={() => setStepIdx(stepIdx - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className={shared.button}
              onClick={goNext}
              disabled={saving || !trimmedTitle}
              title={trimmedTitle ? undefined : "A collection needs a name"}
            >
              {saving ? "Saving…" : isLastStep ? "Save" : "Next"}
            </button>
          </div>
        </>
      }
    >
      <div className={styles.stepsWrap}>
        <div className={styles.steps}>
          {STEPS.map((s, i) => (
            <div key={s.id} className={styles.stepSlot}>
              <button
                type="button"
                className={`${styles.step} ${
                  i === stepIdx ? styles.stepActive : ""
                } ${i < stepIdx ? styles.stepDone : ""}`}
                onClick={() => setStepIdx(i)}
              >
                <span className={styles.stepDot}>{i + 1}</span>
                <span className={styles.stepLabel}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className={styles.stepSep} />}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.body} key={step.id}>
        {step.id === "details" && (
          <>
            <h3 className={styles.stepHeading}>Name and summary</h3>
            <p className={styles.stepSub}>Both are written straight to Plex, and are what viewers see.</p>

            <div className={styles.field}>
              <label htmlFor="collection-title">Name</label>
              <input
                id="collection-title"
                className={shared.input}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Collection name"
                spellCheck={false}
                autoFocus
              />
              {!trimmedTitle && <span className={styles.errorText}>A collection needs a name.</span>}
            </div>

            <div className={styles.field}>
              <label htmlFor="collection-summary">Summary</label>
              <textarea
                id="collection-summary"
                className={styles.summaryInput}
                rows={4}
                value={draftSummary}
                onChange={(e) => setDraftSummary(e.target.value)}
                placeholder="A sentence or two about what's in here."
              />
              <span className={styles.hint}>
                Shown under the collection's name in Plex. Leave it empty and Plex shows nothing.
              </span>
            </div>
          </>
        )}

        {step.id === "labels" && (
          <>
            <h3 className={styles.stepHeading}>Labels</h3>
            <p className={styles.stepSub}>
              Labels are how rules and filters find this collection again. They are visible in Plex.
            </p>

            <div className={styles.field}>
              <label htmlFor="collection-label">Add a label</label>
              <div className={styles.addRow}>
                <input
                  id="collection-label"
                  className={shared.input}
                  value={labelInput}
                  data-owns-enter="true"
                  placeholder="Label name…"
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    addLabel();
                  }}
                />
                <button
                  type="button"
                  className={shared.buttonSecondary}
                  onClick={addLabel}
                  disabled={!labelInput.trim()}
                >
                  Add
                </button>
              </div>
              <span className={styles.hint}>Press Enter to add. Nothing is written to Plex until you save.</span>
            </div>

            {draftLabels.length > 0 ? (
              <div className={styles.chipList}>
                {draftLabels.map((label) => (
                  <span key={label} className={`${shared.label} ${styles.chip} ${labelClass(label)}`}>
                    {label}
                    <button
                      type="button"
                      className={shared.labelRemove}
                      title={`Remove "${label}"`}
                      aria-label={`Remove label ${label}`}
                      onClick={() => setDraftLabels((prev) => prev.filter((l) => l !== label))}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className={styles.hint}>No labels yet.</p>
            )}
          </>
        )}

        {step.id === "review" && (
          <>
            <h3 className={styles.stepHeading}>Review</h3>
            <p className={styles.stepSub}>
              {detailsChanged || labelsChanged
                ? "Saving writes these to Plex."
                : "Nothing has changed — saving is a no-op."}
            </p>

            <div className={styles.summary}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Name</span>
                <span className={styles.summaryValue}>{trimmedTitle || EMPTY}</span>
                <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("details")}>
                  Edit
                </button>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Summary</span>
                <span className={styles.summaryValue}>{draftSummary.trim() || EMPTY}</span>
                <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("details")}>
                  Edit
                </button>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Labels</span>
                <span className={styles.summaryValue}>{draftLabels.length ? draftLabels.join(", ") : "None"}</span>
                <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("labels")}>
                  Edit
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

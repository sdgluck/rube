import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isDestructiveMode } from "@tinkerbell/contracts";
import { EMPTY } from "#/format";
import { trpc } from "#/trpc";
import shared from "#/styles/shared.module.css";
import Modal from "#components/Modal";
import { describeCondition } from "#components/smart-filter/format.ts";
import styles from "./RuleWizard.module.css";
import { IMDB_CHART_LABELS, LIST_PROVIDER_LABELS, SEERR_FILTER_LABELS } from "./constants.ts";
import {
  arrServiceForType,
  defaultLimitForType,
  defaultMinItemsForType,
  groupNounForType,
  isFormValid,
  limitFieldLabel,
  requiredSectionTypeForRule,
  RULE_TYPES,
  stepsFor,
  suggestName,
  TYPE_LABELS,
  typeHasActionsStep,
  typeHasLimit,
  pinRotationError,
  rulePins,
  typeHasMinItems,
  typeHasOptionalLimit,
  typeProducesManyCollections,
  validateStep,
  type StepId,
} from "./rule-types.ts";
import { hasSourceStep, SOURCE_STEPS, type SourceStepType } from "./sources/index.ts";

import type {
  ArrFormState,
  CleanupMode,
  OutcomeFormState,
  RuleFormState,
  SmartFilterGroup,
  SmartFilterNode,
} from "./types.ts";

/** The review row — the last place the outcome is stated before saving. */
function describeOutcome(o: OutcomeFormState): string {
  if (o.kind === "collection") return "Build a collection";
  const verb =
    o.mode === "collection_only"
      ? "Queue only"
      : o.mode === "label"
        ? "Label"
        : o.mode === "unmonitor"
          ? "Unmonitor"
          : "Delete";
  const after = ` after ${o.consecutiveRuns} matching run${o.consecutiveRuns === 1 ? "" : "s"}`;
  // Dry run is called out first because it is the difference between a rule
  // that does something and one that only says it would.
  return o.dryRun ? `${verb}${after} — preview only` : `${verb}${after}, max ${o.maxActionsPerRun}/run`;
}

/** One line per mode, saying what it actually does rather than restating it. */
const CLEANUP_MODE_HINTS: Record<CleanupMode, string> = {
  collection_only: "Nothing is removed. The queue collection is the whole point — a shelf you review yourself.",
  label: "Stamps a Tinkerbell:Cleanup label on each item. Nothing is removed; useful as a dry run with a paper trail.",
  unmonitor: "Leaves the files alone but stops Radarr/Sonarr upgrading or re-grabbing them.",
  delete: "Removes the files from disk. There is no undo.",
};

// Re-export the public types so existing `import { ... } from "#pages/Rules/RuleWizard"`
// call sites keep working.
export {
  DEFAULT_ARR_FORM,
  PRESET_THEMES,
  type AiNameStyle,
  type AiVibe,
  type ArrFormState,
  type RuleFormState,
  type SmartFilterGroup,
  type SmartFilterLeaf,
  type SmartFilterNode,
  type SmartFilterOp,
} from "./types.ts";

/**
 * Render a compact one-line summary of a smart_filter tree for the review
 * pane, in the same English the editor uses — "Genre is Horror AND Year is at
 * least 2000". Groups join their children with the appropriate connector and
 * bracket when nested.
 */
function summarizeSmartFilter(group: SmartFilterGroup): string {
  if (group.children.length === 0) return EMPTY;
  return summarizeNode(group, true);
}

function summarizeNode(node: SmartFilterNode, isRoot: boolean): string {
  // Rules store tag values as display names already, so no lookup is needed
  // to render them — unlike the collection editor's per-server keys.
  if (node.kind === "leaf") return describeCondition(node.field, node.op, [node.value]);
  const conn = node.combinator === "all" ? " AND " : " OR ";
  const inside = node.children.map((c) => summarizeNode(c, false)).join(conn);
  return isRoot ? inside : `(${inside})`;
}

interface RuleWizardProps {
  open: boolean;
  mode: "create" | "edit";
  initial: RuleFormState;
  saving: boolean;
  onSave: (form: RuleFormState) => void;
  onCancel: () => void;
}

export default function RuleWizard({ open, mode, initial, saving, onSave, onCancel }: RuleWizardProps) {
  const [form, setForm] = useState<RuleFormState>(initial);
  const [stepIdx, setStepIdx] = useState(0);
  const [showError, setShowError] = useState(false);
  const nameTouchedRef = useRef(mode === "edit");
  const initialKeyRef = useRef<unknown>(null);

  const configQuery = trpc.config.get.useQuery(undefined, { staleTime: 60_000 });
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const sections = sectionsQuery.data || [];

  const omdbConfigured = !!configQuery.data?.global_omdb_api_key;
  const seerrConfigured = !!(configQuery.data?.global_seerr_url && configQuery.data?.global_seerr_api_key);
  const tmdbConfigured = !!configQuery.data?.global_tmdb_api_key;

  // Arr queries — always called (rules of hooks). Only meaningful when the
  // current rule type has an Actions step.
  const arrService = arrServiceForType(form.type, form.chart);
  const arrStatusQuery = trpc.arr.status.useQuery(undefined, { staleTime: 60_000 });
  const arrConfigured = !!arrStatusQuery.data?.[arrService];
  const arrProfilesQuery = trpc.arr.qualityProfiles.useQuery(
    { service: arrService },
    { enabled: arrConfigured && form.arr.enabled, staleTime: 60_000 },
  );
  const arrFoldersQuery = trpc.arr.rootFolders.useQuery(
    { service: arrService },
    { enabled: arrConfigured && form.arr.enabled, staleTime: 60_000 },
  );

  const steps = useMemo(() => stepsFor(form.type, mode), [form.type, mode]);
  const currentStep = steps[Math.min(stepIdx, steps.length - 1)];

  // Reset state when the wizard is freshly opened (initial identity changed).
  useEffect(() => {
    if (!open) return;
    if (initialKeyRef.current === initial) return;
    initialKeyRef.current = initial;
    setForm(initial);
    setStepIdx(0);
    setShowError(false);
    nameTouchedRef.current = mode === "edit" || !!initial.name.trim();
  }, [open, initial, mode]);

  // When type changes (create mode), reset limit / min-items to type defaults.
  // Grouped types default both to 0 — "no cap, no floor".
  useEffect(() => {
    if (mode === "edit") return;
    setForm((prev) => ({
      ...prev,
      limit: defaultLimitForType(prev.type),
      minItems: prev.type === "ai_prompt" ? defaultMinItemsForType(prev.type) : 0,
    }));
  }, [form.type, mode]);

  // Restrict the Scope step to sections relevant to the chosen rule type.
  // `imdb_chart` also auto-selects all matching sections and locks the chips.
  const requiredSectionType = requiredSectionTypeForRule(form.type, form.chart);
  const availableSections = useMemo(
    () => (requiredSectionType ? sections.filter((s) => s.type === requiredSectionType) : sections),
    [sections, requiredSectionType],
  );
  const sectionsLocked = form.type === "imdb_chart" && !!requiredSectionType;

  /**
   * The section whose tag values populate the smart-filter pickers. A rule
   * can span several libraries (or all of them) and stores tag *names*, not
   * per-server keys, so any one representative library gives the right list
   * of genres, studios and so on — prefer one the user actually picked.
   */
  const tagSectionId = useMemo(() => {
    const selected = availableSections.find((s) => form.sections.includes(s.title));
    return (selected ?? availableSections[0])?.key ?? null;
  }, [availableSections, form.sections]);

  useEffect(() => {
    if (form.type !== "imdb_chart" || !requiredSectionType || sections.length === 0) return;
    const locked = sections.filter((s) => s.type === requiredSectionType).map((s) => s.title);
    setForm((prev) => ({ ...prev, sections: locked }));
  }, [form.type, form.chart, requiredSectionType, sections]);

  // For non-imdb_chart constrained types, prune any selected sections that don't match the new constraint.
  useEffect(() => {
    if (!requiredSectionType || form.type === "imdb_chart") return;
    const valid = new Set(availableSections.map((s) => s.title));
    setForm((prev) => {
      const next = prev.sections.filter((t) => valid.has(t));
      return next.length === prev.sections.length ? prev : { ...prev, sections: next };
    });
  }, [form.type, requiredSectionType, availableSections]);

  // Auto-suggest name on entering review (create mode, untouched).
  useEffect(() => {
    if (currentStep?.id !== "review") return;
    if (mode === "edit") return;
    if (nameTouchedRef.current) return;
    const suggested = suggestName(form, sections);
    if (suggested && !form.name.trim()) {
      setForm((prev) => ({ ...prev, name: suggested }));
    }
  }, [
    currentStep?.id,
    mode,
    form.type,
    form.chart,
    form.listId,
    form.listProvider,
    form.collectionName,
    form.filter,
    form.smartFilter,
    form.themes,
    form.customThemes,
    sections,
  ]);

  const handleClose = onCancel;

  const stepError = currentStep ? validateStep(currentStep.id, form) : null;

  const goNext = useCallback(() => {
    if (!currentStep) return;
    const err = validateStep(currentStep.id, form);
    if (err) {
      setShowError(true);
      return;
    }
    setShowError(false);
    if (stepIdx < steps.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      if (isFormValid(form)) onSave(form);
      else setShowError(true);
    }
  }, [currentStep, form, onSave, stepIdx, steps.length]);

  const goBack = useCallback(() => {
    setShowError(false);
    if (stepIdx > 0) setStepIdx(stepIdx - 1);
  }, [stepIdx]);

  // Enter advances a step. Escape is handled by <Modal>.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && !e.shiftKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "TEXTAREA") return;
        if (tag === "BUTTON") return;
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goNext]);

  if (!open) return null;

  const isLastStep = stepIdx === steps.length - 1;
  const primaryLabel = isLastStep ? (mode === "edit" ? "Save" : "Create") : "Next";
  const canPrimary = mode === "edit" ? isFormValid(form) : !stepError;

  function jumpTo(id: StepId) {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIdx(idx);
  }

  // ─── Step renderers ─────────────────────────────────────────────────────

  function renderTypeStep() {
    return (
      <>
        <h3 className={styles.stepHeading}>Choose a rule type</h3>
        <p className={styles.stepSub}>
          Each type drives how the Generate Collections job builds collections during a run.
        </p>
        <div className={styles.typeGrid}>
          {RULE_TYPES.map((t) => {
            const missing = t.requires === "omdb" && !omdbConfigured ? "Requires OMDB API key (Settings → AI)" : null;
            const seerrMissing =
              t.requires === "seerr" && !seerrConfigured ? "Requires Seerr (Settings → Media Managers)" : null;
            const tmdbMissing =
              t.requires === "tmdb" && !tmdbConfigured ? "Requires TMDb API key (Settings → AI)" : null;
            const warn = missing || seerrMissing || tmdbMissing;
            const disabled = mode === "edit" && t.value !== form.type;
            const selected = form.type === t.value;
            return (
              <button
                key={t.value}
                type="button"
                className={`${styles.typeCard} ${selected ? styles.typeCardSelected : ""}`}
                onClick={() => setForm({ ...form, type: t.value })}
                disabled={disabled}
                aria-pressed={selected}
              >
                <span className={styles.typeCardName}>{t.label}</span>
                <span className={styles.typeCardDesc}>{t.description}</span>
                {warn && <span className={styles.typeCardWarn}>{warn}</span>}
              </button>
            );
          })}
        </div>
        {mode === "edit" && <p className={styles.lockHint}>Type can't change once a rule is created.</p>}
      </>
    );
  }

  /**
   * Source step is per-rule-type. Each component lives under
   * `sources/` and registers itself in `SOURCE_STEPS`. Adding a new
   * rule type with a Source step is the only edit needed here — the
   * registry handles dispatch.
   */
  function renderSourceStep() {
    // `form.type` is a plain string (the wizard switches types freely), so the
    // lookup is guarded rather than assumed to hit.
    const SourceComponent = hasSourceStep(form.type) ? SOURCE_STEPS[form.type as SourceStepType] : null;
    if (!SourceComponent) return null;
    return <SourceComponent form={form} setForm={setForm} config={{ seerrConfigured }} tagSectionId={tagSectionId} />;
  }

  function renderScopeStep() {
    return (
      <>
        <h3 className={styles.stepHeading}>Scope</h3>
        <p className={styles.stepSub}>
          Which Plex sections to apply this rule to{typeHasLimit(form.type) ? ", and how many items to include." : "."}
        </p>

        {availableSections.length > 0 ? (
          <div className={styles.field}>
            <div className={styles.sectionsHeader}>
              <label>Sections</label>
              {!sectionsLocked && (
                <button
                  type="button"
                  className={styles.summaryEdit}
                  onClick={() =>
                    setForm({
                      ...form,
                      sections:
                        form.sections.length === availableSections.length ? [] : availableSections.map((s) => s.title),
                    })
                  }
                >
                  {form.sections.length === availableSections.length ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            <div className={styles.sectionChips}>
              {availableSections.map((s) => {
                const selected = form.sections.includes(s.title);
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`${styles.chip} ${selected ? styles.chipSelected : ""}`}
                    onClick={() =>
                      setForm({
                        ...form,
                        sections: selected ? form.sections.filter((t) => t !== s.title) : [...form.sections, s.title],
                      })
                    }
                    disabled={sectionsLocked}
                    aria-pressed={selected}
                  >
                    {s.title}
                  </button>
                );
              })}
            </div>
            <span className={styles.hint}>
              {sectionsLocked
                ? `Locked to ${requiredSectionType === "movie" ? "Movie" : "TV"} sections by the chosen chart.`
                : requiredSectionType
                  ? `Only ${requiredSectionType === "movie" ? "Movie" : "TV"} sections apply to this rule type.`
                  : form.type === "seerr_requests"
                    ? "Seerr produces a single collection — only the first selected Movie/TV section is used."
                    : form.sections.length === 0
                      ? "Default — applies to all sections."
                      : `${form.sections.length} selected.`}
            </span>
          </div>
        ) : requiredSectionType && sections.length > 0 ? (
          <div className={styles.field}>
            <label>Sections</label>
            <span className={styles.hint}>
              No {requiredSectionType === "movie" ? "Movie" : "TV"} sections found in your Plex library — this rule type
              won't produce any collections.
            </span>
          </div>
        ) : null}

        {typeHasLimit(form.type) &&
          (typeHasOptionalLimit(form.type) ? (
            <div className={styles.field}>
              <label>
                <input
                  type="checkbox"
                  checked={form.limit > 0}
                  onChange={(e) => setForm({ ...form, limit: e.target.checked ? 25 : 0 })}
                />{" "}
                Cap the number of collections
              </label>
              {form.limit > 0 && (
                <input
                  type="number"
                  className={shared.input}
                  style={{ maxWidth: 140 }}
                  min={1}
                  value={form.limit}
                  onChange={(e) => setForm({ ...form, limit: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  aria-label={limitFieldLabel(form.type)}
                />
              )}
              <span className={styles.hint}>
                {form.limit > 0
                  ? `Builds the ${form.limit} largest ${groupNounForType(form.type)} collections per library; the rest are skipped.`
                  : `Off — one collection per ${groupNounForType(form.type)}, however many that turns out to be.`}
              </span>
            </div>
          ) : (
            <div className={styles.field}>
              <label htmlFor="rule-limit">{limitFieldLabel(form.type)}</label>
              <input
                id="rule-limit"
                type="number"
                className={shared.input}
                style={{ maxWidth: 140 }}
                min={1}
                value={form.limit}
                onChange={(e) =>
                  setForm({
                    ...form,
                    limit: Math.max(1, parseInt(e.target.value, 10) || 1),
                  })
                }
              />
              <span className={styles.hint}>
                {form.type === "seerr_requests"
                  ? "We'll fetch as many Seerr requests as needed to fill the collection up to this many items."
                  : typeProducesManyCollections(form.type)
                    ? "How many to pull from TMDb each run. Each one costs API calls, so this is a fetch budget rather than a collection cap."
                    : "Collections replace those generated in previous runs."}
              </span>
            </div>
          ))}

        {typeHasMinItems(form.type) && (
          <div className={styles.field}>
            <label>
              <input
                type="checkbox"
                checked={form.minItems > 0}
                onChange={(e) =>
                  setForm({ ...form, minItems: e.target.checked ? defaultMinItemsForType(form.type) : 0 })
                }
              />{" "}
              Skip small collections
            </label>
            {form.minItems > 0 && (
              <input
                type="number"
                className={shared.input}
                style={{ maxWidth: 140 }}
                min={1}
                value={form.minItems}
                onChange={(e) => setForm({ ...form, minItems: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                aria-label="Minimum items per collection"
              />
            )}
            <span className={styles.hint}>
              {form.minItems > 0
                ? `Only builds a collection for a ${groupNounForType(form.type)} with ${form.minItems}+ items in the library.`
                : `Off — every ${groupNounForType(form.type)} gets a collection, including ones with a single item. Large libraries can produce hundreds or thousands of collections this way.`}
            </span>
          </div>
        )}

        {form.type === "rt_top_rated" && !omdbConfigured && (
          <p className={styles.hint}>Heads-up: OMDB API key is not configured in Settings → AI.</p>
        )}

        {/* A cleanup rule's shelf is never pinned, so none of this applies to
            it — see `rulePins`. The Outcome step comes first precisely so this
            block can be absent rather than retracted. */}
        {form.outcome.kind === "cleanup" && (
          <p className={styles.hint}>
            Cleanup rules don't touch the homepage. The queue collection is created and labelled, but never pinned — a
            row of items about to be removed isn't something to open Plex to.
          </p>
        )}

        {form.outcome.kind === "collection" && (
          <>
            <div className={styles.field}>
              <label>
                <input
                  type="checkbox"
                  checked={form.pinToHomepage}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      pinToHomepage: e.target.checked,
                      // This rule type can produce hundreds of collections, so
                      // pinning always means "rotate a handful" — seed a count
                      // rather than letting the user pin the lot.
                      pinRotationCount:
                        e.target.checked && typeProducesManyCollections(form.type) && form.pinRotationCount === 0
                          ? 10
                          : form.pinRotationCount,
                    })
                  }
                />{" "}
                Pin generated collections to homepage
              </label>
              <span className={styles.hint}>
                When off, collections are still created in Plex but won't be promoted to the home, recommended, or
                shared home rows.
              </span>
            </div>

            {form.pinToHomepage && typeProducesManyCollections(form.type) && (
              <div className={styles.field}>
                <label htmlFor="rule-pin-rotation">Collections on the homepage at a time</label>
                <input
                  id="rule-pin-rotation"
                  type="number"
                  className={shared.input}
                  style={{ maxWidth: 140 }}
                  min={1}
                  value={form.pinRotationCount || ""}
                  onChange={(e) =>
                    setForm({ ...form, pinRotationCount: Math.max(0, parseInt(e.target.value, 10) || 0) })
                  }
                />
                <span className={styles.hint}>
                  {form.pinRotationCount > 0
                    ? `Each run pins ${form.pinRotationCount} of this rule's collections per library, picked at random. ` +
                      "Consecutive runs pick a different set — with no overlap, as long as the rule produces more than " +
                      `${form.pinRotationCount * 2} collections.`
                    : "Required — this rule type can build far more collections than a homepage can show."}
                </span>
              </div>
            )}

            {form.pinToHomepage && !typeProducesManyCollections(form.type) && (
              <div className={styles.field}>
                <label>
                  <input
                    type="checkbox"
                    checked={form.pinRotationCount > 0}
                    onChange={(e) => setForm({ ...form, pinRotationCount: e.target.checked ? 10 : 0 })}
                  />{" "}
                  Rotate a limited number onto the homepage
                </label>
                {form.pinRotationCount > 0 && (
                  <input
                    type="number"
                    className={shared.input}
                    style={{ maxWidth: 140 }}
                    min={1}
                    value={form.pinRotationCount}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pinRotationCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                  />
                )}
                <span className={styles.hint}>
                  {form.pinRotationCount > 0
                    ? `Each run pins ${form.pinRotationCount} of this rule's collections per library, picked at random. ` +
                      "Consecutive runs pick a different set — with no overlap, as long as the rule produces more than " +
                      `${form.pinRotationCount * 2} collections.`
                    : "When off, every collection this rule generates is pinned."}
                </span>
              </div>
            )}

            {form.pinToHomepage && (
              <div className={styles.field}>
                <label>
                  <input
                    type="checkbox"
                    checked={form.pinMinItems > 0}
                    onChange={(e) => setForm({ ...form, pinMinItems: e.target.checked ? 5 : 0 })}
                  />{" "}
                  Only pin collections with enough items
                </label>
                {form.pinMinItems > 0 && (
                  <input
                    type="number"
                    className={shared.input}
                    style={{ maxWidth: 140 }}
                    min={1}
                    value={form.pinMinItems}
                    onChange={(e) => setForm({ ...form, pinMinItems: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    aria-label="Minimum items to pin a collection"
                  />
                )}
                <span className={styles.hint}>
                  {form.pinMinItems > 0
                    ? `Only collections with ${form.pinMinItems}+ items reach the homepage. Smaller ones are still created in Plex, just not promoted.`
                    : "Off — every collection this rule pins goes to the homepage, however few items it has."}
                </span>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  /**
   * "What should happen to matches?"
   *
   * Collection is preselected and is what every rule did before this step
   * existed. Choosing Cleanup reveals the knobs and a confirmation panel that
   * spells out, in plain English, what one run will actually do — this is the
   * last screen where somebody can notice they've built a scheduled deletion.
   */
  function renderOutcomeStep() {
    const o = form.outcome;
    const setOutcome = (patch: Partial<OutcomeFormState>) => setForm({ ...form, outcome: { ...o, ...patch } });
    const destructive = isDestructiveMode(o.mode);

    return (
      <>
        <h3 className={styles.stepHeading}>What should happen to matches?</h3>
        <p className={styles.stepSub}>
          Every rule selects items the same way. This is what it does with them once it has.
        </p>

        <div className={styles.outcomeChoices}>
          <button
            type="button"
            className={`${styles.outcomeCard} ${o.kind === "collection" ? styles.outcomeCardActive : ""}`}
            onClick={() => setOutcome({ kind: "collection" })}
            aria-pressed={o.kind === "collection"}
          >
            <input type="radio" checked={o.kind === "collection"} readOnly tabIndex={-1} />
            <span>
              <span className={styles.outcomeCardTitle}>Build a collection</span>
              <span className={styles.outcomeCardBody}>
                Create or refresh a Plex collection from the matching items. This is what rules normally do.
              </span>
            </span>
          </button>

          <button
            type="button"
            className={`${styles.outcomeCard} ${o.kind === "cleanup" ? styles.outcomeCardActive : ""}`}
            onClick={() => setOutcome({ kind: "cleanup" })}
            aria-pressed={o.kind === "cleanup"}
          >
            <input type="radio" checked={o.kind === "cleanup"} readOnly tabIndex={-1} />
            <span>
              <span className={styles.outcomeCardTitle}>Clean up</span>
              <span className={styles.outcomeCardBody}>
                Track matching items over several runs, then label, unmonitor, or delete them. Always builds a queue
                collection first so you can see what's on the chopping block.
              </span>
            </span>
          </button>
        </div>

        {o.kind === "cleanup" && (
          <>
            <div className={styles.field}>
              <label htmlFor="cleanup-mode">Action</label>
              <select
                id="cleanup-mode"
                className={shared.input}
                value={o.mode}
                onChange={(e) => {
                  const mode = e.target.value as CleanupMode;
                  // Stepping up to a destructive mode re-arms dry run and the
                  // streak floor. Someone who switches from "label" to "delete"
                  // on an existing rule should not inherit settings that were
                  // only safe for labelling.
                  setOutcome(
                    isDestructiveMode(mode)
                      ? { mode, dryRun: true, consecutiveRuns: Math.max(o.consecutiveRuns, 3) }
                      : { mode },
                  );
                }}
              >
                <option value="collection_only">Queue only — just build the collection</option>
                <option value="label">Label matching items in Plex</option>
                <option value="unmonitor">Unmonitor in Radarr/Sonarr</option>
                <option value="delete">Delete the files</option>
              </select>
              <span className={styles.hint}>{CLEANUP_MODE_HINTS[o.mode]}</span>
            </div>

            <div className={styles.field}>
              <label htmlFor="cleanup-runs">Consecutive matching runs before acting</label>
              <input
                id="cleanup-runs"
                type="number"
                min={destructive ? 2 : 1}
                className={shared.input}
                value={o.consecutiveRuns}
                onChange={(e) => setOutcome({ consecutiveRuns: parseInt(e.target.value, 10) || 1 })}
              />
              <span className={styles.hint}>
                An item that stops matching loses its streak and starts over, so a one-off metadata glitch can never
                trigger this rule.
              </span>
            </div>

            <div className={styles.field}>
              <label htmlFor="cleanup-cap">Most items to action in one run</label>
              <input
                id="cleanup-cap"
                type="number"
                min={1}
                className={shared.input}
                value={o.maxActionsPerRun}
                onChange={(e) => setOutcome({ maxActionsPerRun: parseInt(e.target.value, 10) || 1 })}
              />
            </div>

            {o.mode === "delete" && (
              <>
                <div className={styles.field}>
                  <label>
                    <input
                      type="checkbox"
                      checked={o.viaArr}
                      onChange={(e) => setOutcome({ viaArr: e.target.checked })}
                    />{" "}
                    Delete through Radarr/Sonarr
                  </label>
                  <span className={styles.hint}>
                    Strongly recommended. Deleting in Plex alone leaves the Radarr/Sonarr record behind, and it will
                    re-download the same file. With this on, an item with no matching record is skipped rather than
                    half-deleted.
                  </span>
                </div>
                <div className={styles.field}>
                  <label>
                    <input
                      type="checkbox"
                      checked={o.addImportExclusion}
                      onChange={(e) => setOutcome({ addImportExclusion: e.target.checked })}
                    />{" "}
                    Add to the import exclusion list
                  </label>
                  <span className={styles.hint}>
                    Stops a list you subscribe to from re-adding it later. Undo means editing the exclusion list in
                    Radarr/Sonarr by hand.
                  </span>
                </div>
              </>
            )}

            <div className={styles.field}>
              <label>
                <input type="checkbox" checked={o.dryRun} onChange={(e) => setOutcome({ dryRun: e.target.checked })} />{" "}
                Preview only — don't touch anything yet
              </label>
              <span className={styles.hint}>
                Leave this on until you've run the rule and read the log. The queue collection is built either way.
              </span>
            </div>

            {destructive && !o.dryRun && (
              <div className={styles.dangerPanel} role="alert">
                <p className={styles.dangerPanelHeading}>
                  This rule will {o.mode === "delete" ? "delete" : "change"} things on its own
                </p>
                <p className={styles.dangerPanelBody}>
                  Every time this rule runs, any item that has matched{" "}
                  <strong>
                    {o.consecutiveRuns} run{o.consecutiveRuns === 1 ? "" : "s"} in a row
                  </strong>{" "}
                  will be{" "}
                  <strong>
                    {o.mode === "delete"
                      ? o.viaArr
                        ? "deleted from Radarr/Sonarr, along with its files"
                        : "deleted from Plex"
                      : "unmonitored in Radarr/Sonarr"}
                  </strong>
                  , up to {o.maxActionsPerRun} item{o.maxActionsPerRun === 1 ? "" : "s"} per run.{" "}
                  {o.mode === "delete" && "There is no undo."}
                </p>
                <p className={styles.dangerPanelBody}>
                  Cleanup also has to be switched on globally in Settings before any of this happens, and it is skipped
                  entirely if the library hasn't synced in the last two days or if the rule suddenly matches more than a
                  quarter of your library.
                </p>
              </div>
            )}
          </>
        )}
      </>
    );
  }

  function renderActionsStep() {
    const service = arrService;
    const profilesQuery = arrProfilesQuery;
    const foldersQuery = arrFoldersQuery;
    const profiles = profilesQuery.data ?? [];
    const folders = foldersQuery.data ?? [];
    const setArr = (patch: Partial<ArrFormState>) => setForm({ ...form, arr: { ...form.arr, ...patch } });

    return (
      <>
        <h3 className={styles.stepHeading}>Send missing items to {service === "radarr" ? "Radarr" : "Sonarr"}</h3>
        <p className={styles.stepSub}>
          When this rule runs, items from the source that aren't in your Plex library can be sent to{" "}
          {service === "radarr" ? "Radarr" : "Sonarr"} for download. Off by default.
        </p>

        {!arrConfigured && (
          <p className={styles.hint}>
            {service === "radarr" ? "Radarr" : "Sonarr"} is not configured in Settings → Media Managers.
          </p>
        )}

        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={form.arr.enabled}
              onChange={(e) => setArr({ enabled: e.target.checked })}
              disabled={!arrConfigured}
            />{" "}
            Enable
          </label>
        </div>

        {form.arr.enabled && (
          <>
            <div className={styles.field}>
              <label htmlFor="arr-quality">Quality profile</label>
              <select
                id="arr-quality"
                className={shared.input}
                value={form.arr.qualityProfileId}
                onChange={(e) => setArr({ qualityProfileId: parseInt(e.target.value, 10) || 0 })}
              >
                <option value={0}>{profilesQuery.isLoading ? "Loading…" : "— pick a profile —"}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {profilesQuery.error && (
                <span className={styles.hint}>Couldn't load profiles: {profilesQuery.error.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="arr-root">Root folder</label>
              <select
                id="arr-root"
                className={shared.input}
                value={form.arr.rootFolderPath}
                onChange={(e) => setArr({ rootFolderPath: e.target.value })}
              >
                <option value="">{foldersQuery.isLoading ? "Loading…" : "— pick a folder —"}</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
              {foldersQuery.error && (
                <span className={styles.hint}>Couldn't load folders: {foldersQuery.error.message}</span>
              )}
            </div>

            <div className={styles.field}>
              <label>
                <input
                  type="checkbox"
                  checked={form.arr.monitor}
                  onChange={(e) => setArr({ monitor: e.target.checked })}
                />{" "}
                Monitor added items
              </label>
            </div>

            <div className={styles.field}>
              <label>
                <input
                  type="checkbox"
                  checked={form.arr.searchOnAdd}
                  onChange={(e) => setArr({ searchOnAdd: e.target.checked })}
                />{" "}
                Search on add
              </label>
              <span className={styles.hint}>
                If off, items are added but not searched until your next scheduled scan.
              </span>
            </div>

            <div className={styles.field}>
              <label htmlFor="arr-cap">Max adds per run</label>
              <input
                id="arr-cap"
                type="number"
                className={shared.input}
                style={{ maxWidth: 140 }}
                min={1}
                max={500}
                value={form.arr.maxAddsPerRun}
                onChange={(e) =>
                  setArr({ maxAddsPerRun: Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)) })
                }
              />
              <span className={styles.hint}>Safety cap. Extras beyond this number are skipped each run.</span>
            </div>

            <div className={styles.field}>
              <label>
                <input
                  type="checkbox"
                  checked={form.arr.dryRun}
                  onChange={(e) => setArr({ dryRun: e.target.checked })}
                />{" "}
                Dry run (log only — don't actually add)
              </label>
              <span className={styles.hint}>Recommended on first save. Disable once the run log looks right.</span>
            </div>
          </>
        )}
      </>
    );
  }

  function renderReviewStep() {
    const sectionsText =
      form.sections.length === 0
        ? "All sections"
        : form.sections.length === availableSections.length
          ? "All sections"
          : form.sections.join(", ");

    let sourceLabel: string | null = null;
    let sourceValue: string | null = null;
    if (form.type === "ai_prompt") {
      sourceLabel = "Themes";
      const all = [...form.themes, ...form.customThemes.filter((t) => t.trim().length > 0)];
      sourceValue = all.length === 0 ? EMPTY : all.join(", ");
    } else if (form.type === "imdb_chart") {
      sourceLabel = "Chart";
      sourceValue = IMDB_CHART_LABELS[form.chart] || form.chart;
    } else if (form.type === "imdb_list") {
      sourceLabel = "List";
      sourceValue = form.listId;
    } else if (form.type === "list_source") {
      sourceLabel = "List";
      const provider = LIST_PROVIDER_LABELS[form.listProvider] ?? form.listProvider;
      sourceValue = form.listId.trim() ? `${provider} — ${form.listId.trim()}` : provider;
    } else if (form.type === "smart_filter") {
      sourceLabel = "Filter";
      sourceValue = summarizeSmartFilter(form.smartFilter);
    } else if (form.type === "seerr_requests") {
      sourceLabel = "Filter";
      sourceValue = SEERR_FILTER_LABELS[form.filter] || form.filter;
    }

    return (
      <>
        <h3 className={styles.stepHeading}>Name & review</h3>
        <p className={styles.stepSub}>Give the rule a name. The summary below shows what will be saved.</p>

        <div className={styles.field}>
          <label htmlFor="rule-name">Name</label>
          <input
            id="rule-name"
            className={shared.input}
            value={form.name}
            onChange={(e) => {
              nameTouchedRef.current = true;
              setForm({ ...form, name: e.target.value });
            }}
            placeholder="Rule name"
            autoFocus={mode === "create"}
          />
          {showError && stepError && <span className={styles.errorText}>{stepError}</span>}
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Type</span>
            <span className={styles.summaryValue}>{TYPE_LABELS[form.type] || form.type}</span>
            <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("type")}>
              Edit
            </button>
          </div>
          {sourceLabel && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>{sourceLabel}</span>
              <span className={styles.summaryValue}>{sourceValue || EMPTY}</span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("source")}>
                Edit
              </button>
            </div>
          )}
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Sections</span>
            <span className={styles.summaryValue}>{sectionsText}</span>
            <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("scope")}>
              Edit
            </button>
          </div>
          {typeHasLimit(form.type) && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>{limitFieldLabel(form.type)}</span>
              <span className={styles.summaryValue}>{form.limit > 0 ? form.limit : "No cap"}</span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("scope")}>
                Edit
              </button>
            </div>
          )}
          {(form.type === "ai_prompt" || typeHasMinItems(form.type)) && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Min items</span>
              <span className={styles.summaryValue}>{form.minItems > 0 ? form.minItems : "No minimum"}</span>
              <button
                type="button"
                className={styles.summaryEdit}
                onClick={() => jumpTo(form.type === "ai_prompt" ? "source" : "scope")}
              >
                Edit
              </button>
            </div>
          )}
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>Outcome</span>
            <span className={styles.summaryValue}>{describeOutcome(form.outcome)}</span>
            <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("outcome")}>
              Edit
            </button>
          </div>
          {/* Pinning is a collection-rule concern only — a cleanup rule's
              shelf is never pinned, so stating it here would be a promise the
              job doesn't keep. */}
          {form.outcome.kind === "collection" && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Pin to homepage</span>
              <span className={styles.summaryValue}>
                {!form.pinToHomepage
                  ? "Off"
                  : form.pinRotationCount > 0
                    ? `On — ${form.pinRotationCount}/library, rotating`
                    : (pinRotationError(form) ?? "On")}
              </span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("scope")}>
                Edit
              </button>
            </div>
          )}
          {rulePins(form) && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Min items to pin</span>
              <span className={styles.summaryValue}>{form.pinMinItems > 0 ? form.pinMinItems : "No minimum"}</span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("scope")}>
                Edit
              </button>
            </div>
          )}
          {typeHasActionsStep(form.type) && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Send to *arr</span>
              <span className={styles.summaryValue}>
                {form.arr.enabled
                  ? `${arrServiceForType(form.type, form.chart)}${form.arr.dryRun ? " (dry run)" : ""}, max ${form.arr.maxAddsPerRun}/run`
                  : "Off"}
              </span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("actions")}>
                Edit
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  function renderStep() {
    if (!currentStep) return null;
    if (currentStep.id === "type") return renderTypeStep();
    if (currentStep.id === "source") return renderSourceStep();
    if (currentStep.id === "scope") return renderScopeStep();
    if (currentStep.id === "outcome") return renderOutcomeStep();
    if (currentStep.id === "actions") return renderActionsStep();
    if (currentStep.id === "review") return renderReviewStep();
    return null;
  }

  return (
    <Modal
      open
      onClose={handleClose}
      title={mode === "edit" ? `Edit "${initial.name || "Rule"}"` : "Add Rule"}
      size="lg"
      dismissOnBackdrop={false}
      footer={
        <>
          <div className={styles.footerLeft}>
            <button type="button" className={shared.buttonSecondary} onClick={handleClose}>
              Cancel
            </button>
          </div>
          <div className={styles.footerRight}>
            {stepIdx > 0 && (
              <button type="button" className={shared.buttonSecondary} onClick={goBack}>
                Back
              </button>
            )}
            <button type="button" className={shared.button} onClick={goNext} disabled={saving || !canPrimary}>
              {saving ? "Saving…" : primaryLabel}
            </button>
          </div>
        </>
      }
    >
      <div className={styles.stepsWrap}>
        <div className={styles.steps}>
          {steps.map((s, i) => {
            const active = i === stepIdx;
            const done = i < stepIdx;
            const clickable = mode === "edit" || i <= stepIdx;
            return (
              <div key={s.id} style={{ display: "contents" }}>
                <button
                  type="button"
                  className={`${styles.step} ${active ? styles.stepActive : ""} ${done ? styles.stepDone : ""} ${clickable ? styles.stepClickable : ""}`}
                  onClick={() => clickable && setStepIdx(i)}
                  disabled={!clickable}
                >
                  <span className={styles.stepDot}>{i + 1}</span>
                  <span className={styles.stepLabel}>{s.label}</span>
                </button>
                {i < steps.length - 1 && <div className={styles.stepSep} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.body} key={currentStep?.id}>
        {renderStep()}
        {showError && stepError && currentStep?.id !== "review" && <p className={styles.stepErrorText}>{stepError}</p>}
      </div>
    </Modal>
  );
}

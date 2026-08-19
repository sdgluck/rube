import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  approximateCount,
  describeCondition,
  describeRuleWindow,
  estimateCollectionCount,
  isDestructiveMode,
  RULE_TRIGGERS,
  RULE_TRIGGER_LABELS,
  RULE_TRIGGER_NOTES,
  METADATA_SETTABLE_FIELDS,
  METADATA_TOKENS,
  SORT_ARTICLES,
  templateError,
  templatedCollectionSummary,
  volumeLevel,
} from "@tinkerbell/contracts";
import CollectionPosterPreview from "#components/CollectionPosterPreview";
import CronPreview from "#components/CronPreview";
import MultiSelect from "#components/MultiSelect";
import { EMPTY } from "#/format";
import { trpc } from "#/trpc";
import shared from "#/styles/shared.module.css";
import Modal from "#components/Modal";
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
  ruleTypesFor,
  stepsFor,
  suggestName,
  TYPE_LABELS,
  typeHasActionsStep,
  typeHasLimit,
  pinRotationError,
  presentationError,
  rulePins,
  typeHasMinItems,
  typeHasOptionalLimit,
  typeMinItemsOnByDefault,
  typeProducesManyCollections,
  validateStep,
  type StepId,
} from "./rule-types.ts";
import { hasSourceStep, SOURCE_STEPS, type SourceStepType } from "./sources/index.ts";
import { buildPresetFilter, CLEANUP_PRESETS, type CleanupPreset } from "./cleanup-presets.ts";

import type {
  ArrFormState,
  CleanupMode,
  MetadataSettableField,
  OutcomeFormState,
  PresentationFormState,
  RuleFormState,
  ScheduleFormState,
  SmartFilterGroup,
  SmartFilterNode,
} from "./types.ts";

/**
 * A stand-in group name, so a grouped rule's preview shows a plausible
 * collection title rather than the rule's own name. "By Director" is not a
 * collection anyone will ever see; "Christopher Nolan" is.
 */
const SAMPLE_GROUP_NAMES: Record<string, string> = {
  actors: "Cate Blanchett",
  tmdb_popular_actors: "Cate Blanchett",
  directors: "Christopher Nolan",
  tmdb_popular_directors: "Christopher Nolan",
  studios: "A24",
  networks: "HBO",
  streaming: "Netflix",
  genres: "Science Fiction",
  countries: "South Korea",
  content_ratings: "R",
  decades: "1990s",
  years: "1994",
  resolutions: "4K",
  audio_languages: "Japanese",
  subtitle_languages: "French",
  video_formats: "Bluray",
  based_on: "Based on a Novel",
  seasonal: "Halloween",
  awards: "Academy Award Winners",
  tmdb_franchises: "The Lord of the Rings",
};

function sampleCollectionName(type: string): string {
  return SAMPLE_GROUP_NAMES[type] ?? "Collection";
}

/** The exact sentence the templated summary would produce, or why it can't. */
function templatedSummaryHint(type: string, sampleTitle: string, sectionType: string | undefined): string {
  const example = templatedCollectionSummary({
    ruleType: type,
    collectionName: SAMPLE_GROUP_NAMES[type] ?? sampleTitle,
    sectionType,
  });
  return example
    ? `Deterministic, free, and written before the collection is a second old. For example: "${example}"`
    : "This rule type picks its own titles, so there's no sentence to derive from it — the AI option is the one that can describe these.";
}

/** The review row — the last place the outcome is stated before saving. */
function describeOutcome(o: OutcomeFormState): string {
  if (o.kind === "collection") return "Build a collection";
  if (o.kind === "metadata") {
    const fields = METADATA_SETTABLE_FIELDS.filter((f) => o.set[f].trim() !== "");
    const tags = [
      ...(o.addGenres.length || o.addLabels.length ? ["add tags"] : []),
      ...(o.removeGenres.length || o.removeLabels.length ? ["remove tags"] : []),
    ];
    const what = [...fields.map((f) => METADATA_FIELD_LABELS[f].toLowerCase()), ...tags].join(", ") || "nothing";
    const lock = o.lock ? ", locked" : ", unlocked";
    // Preview-only first, for the same reason as cleanup: it is the difference
    // between a rule that does something and one that only says it would.
    return o.dryRun ? `Set ${what} — preview only` : `Set ${what}${lock}, max ${o.maxWritesPerRun}/run`;
  }
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

/** The review row for the Look step — poster first, because it's the visible one. */
function describePresentation(p: PresentationFormState): string {
  const poster =
    p.poster === "none"
      ? "No artwork"
      : p.poster === "url"
        ? "Artwork from a URL"
        : `${p.poster[0].toUpperCase()}${p.poster.slice(1)} poster`;
  const summary =
    p.summary === "none"
      ? "no description"
      : p.summary === "custom"
        ? "a fixed description"
        : p.summary === "llm"
          ? "an AI-written description"
          : "a description from the rule";
  return `${poster}, ${summary}`;
}

const METADATA_FIELD_LABELS: Record<MetadataSettableField, string> = {
  title: "Title",
  titleSort: "Sort title",
  summary: "Summary",
  tagline: "Tagline",
  contentRating: "Content rating",
  studio: "Studio",
  originallyAvailableAt: "Originally available",
};

/**
 * Placeholders that teach the token vocabulary by example.
 *
 * `{sortableTitle}` on the sort title is the one most people arrive for, so it
 * is shown where they will look for it rather than only in the token list.
 */
const METADATA_FIELD_PLACEHOLDERS: Record<MetadataSettableField, string> = {
  title: "{title}",
  titleSort: "{sortableTitle}",
  summary: "",
  tagline: "",
  contentRating: "PG-13",
  studio: "",
  originallyAvailableAt: "",
};

/** Comma-separated tags, trimmed, with the blanks dropped. */
function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** One line per mode, saying what it actually does rather than restating it. */
const CLEANUP_MODE_HINTS: Record<CleanupMode, string> = {
  collection_only: "Nothing is removed and nothing is written to Plex. Matches just gather on the Cleanup queue.",
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

  // Candidates for `afterRules`. Fetched only while the wizard is open —
  // everything else on this screen is local, and a list of every rule is not
  // worth holding for a panel most visits never scroll to. Self is excluded
  // here as well as in the runner: a rule offering to run after itself reads
  // as a feature rather than as the no-op it is.
  const rulesQuery = trpc.rules.list.useQuery(undefined, { enabled: open, staleTime: 30_000 });
  const chainableRules = useMemo(
    () => (rulesQuery.data ?? []).filter((r) => r.id !== form.id).map((r) => ({ value: r.id, label: r.name })),
    [rulesQuery.data, form.id],
  );
  const sections = sectionsQuery.data || [];

  const omdbConfigured = !!configQuery.data?.global_omdb_api_key;
  const seerrConfigured = !!(configQuery.data?.global_seerr_url && configQuery.data?.global_seerr_api_key);
  const tmdbConfigured = !!configQuery.data?.global_tmdb_api_key;

  // Arr queries — always called (rules of hooks). Only meaningful when the
  // current rule type has an Actions step.
  const arrService = arrServiceForType(form.type, form.chart);
  const arrStatusQuery = trpc.arr.status.useQuery(undefined, { staleTime: 60_000 });
  const arrConfigured = !!arrStatusQuery.data?.[arrService];
  const arrInstancesQuery = trpc.arr.instances.useQuery(undefined, { staleTime: 60_000 });
  const arrInstancesForService = (arrInstancesQuery.data ?? []).filter((i) => i.service === arrService);
  const arrProfilesQuery = trpc.arr.qualityProfiles.useQuery(
    // Quality profiles and root folders belong to one instance, so switching
    // instance has to re-ask rather than reuse the other one's answers.
    { service: arrService, instanceId: form.arr.instanceId || undefined },
    { enabled: arrConfigured && form.arr.enabled, staleTime: 60_000 },
  );
  const arrFoldersQuery = trpc.arr.rootFolders.useQuery(
    { service: arrService, instanceId: form.arr.instanceId || undefined },
    { enabled: arrConfigured && form.arr.enabled, staleTime: 60_000 },
  );

  const steps = useMemo(() => stepsFor(form.type, mode, form.outcome.kind), [form.type, mode, form.outcome.kind]);
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
  // Grouped types still default to no cap — capping to the N largest silently
  // drops groups the user never heard about. The floor is different: for the
  // types that fan out into thousands of one-item groups it starts on, because
  // "every production company that ever took a credit" is not a library
  // anybody asked for. Low-cardinality types (decades, genres) still get 0.
  useEffect(() => {
    if (mode === "edit") return;
    setForm((prev) => ({
      ...prev,
      limit: defaultLimitForType(prev.type),
      minItems: prev.type === "ai_prompt" || typeMinItemsOnByDefault(prev.type) ? defaultMinItemsForType(prev.type) : 0,
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
   * Library size behind the current scope, and the collection count it
   * implies. Only fetched for the types where the answer can be alarming —
   * a single-collection rule builds one collection whatever the library holds.
   */
  const volumeMatters = typeProducesManyCollections(form.type);
  const itemCountsQuery = trpc.plexSectionItemCounts.useQuery(undefined, {
    enabled: open && volumeMatters,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const volume = useMemo(() => {
    if (!volumeMatters) return null;
    const counts = itemCountsQuery.data;
    if (!counts) return null;
    // An empty selection means every available section, which is what the
    // Sections chips and the job both take it to mean.
    const scoped =
      form.sections.length > 0 ? availableSections.filter((s) => form.sections.includes(s.title)) : availableSections;
    const libraryItems = scoped.reduce((sum, s) => sum + (counts[s.title] ?? 0), 0);
    const estimate = estimateCollectionCount({
      type: form.type,
      libraryItems,
      minItems: form.minItems,
      limit: form.limit,
    });
    if (estimate === null) return null;
    return { estimate, libraryItems, level: volumeLevel(estimate) };
  }, [volumeMatters, itemCountsQuery.data, form.sections, form.type, form.minItems, form.limit, availableSections]);

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

  /**
   * Pick a preset: it writes the filter, so the type comes with it. Choosing a
   * second preset overwrites the first — they are alternatives, not clauses to
   * accumulate, and a half-merged tree is worse than either.
   */
  function choosePreset(preset: CleanupPreset) {
    setForm({
      ...form,
      type: "smart_filter",
      cleanupPreset: preset.value,
      smartFilter: buildPresetFilter(preset, preset.knobDefault),
    });
  }

  function renderTypeStep() {
    const kind = form.outcome.kind;
    const types = ruleTypesFor(kind);
    const heading =
      kind === "cleanup"
        ? "What should this rule look for?"
        : kind === "metadata"
          ? "Which items?"
          : "Choose a rule type";
    const sub =
      kind === "cleanup"
        ? "Start from one of these, or pick a way to select items yourself. Nothing is removed until you have set the action and the streak on the next step."
        : kind === "metadata"
          ? "How this rule picks the items it will rewrite. Types that slice the library into one collection per director or decade aren't offered here — a metadata rule writes to items, not groups."
          : "Each type drives how the Generate Collections job builds collections during a run.";

    return (
      <>
        <h3 className={styles.stepHeading}>{heading}</h3>
        <p className={styles.stepSub}>{sub}</p>
        {kind === "cleanup" && (
          <>
            <div className={styles.typeGrid}>
              {CLEANUP_PRESETS.map((p) => {
                const selected = form.cleanupPreset === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    className={`${styles.typeCard} ${selected ? styles.typeCardSelected : ""}`}
                    onClick={() => choosePreset(p)}
                    disabled={mode === "edit"}
                    aria-pressed={selected}
                  >
                    <span className={styles.typeCardName}>{p.label}</span>
                    <span className={styles.typeCardDesc}>{p.description}</span>
                  </button>
                );
              })}
            </div>
            <p className={styles.stepSub}>Or select the items yourself:</p>
          </>
        )}
        <div className={styles.typeGrid}>
          {types.map((t) => {
            const missing = t.requires === "omdb" && !omdbConfigured ? "Requires OMDB API key (Settings → AI)" : null;
            const seerrMissing =
              t.requires === "seerr" && !seerrConfigured ? "Requires Seerr (Settings → Media Managers)" : null;
            const tmdbMissing =
              t.requires === "tmdb" && !tmdbConfigured ? "Requires TMDb API key (Settings → AI)" : null;
            const warn = missing || seerrMissing || tmdbMissing;
            const disabled = mode === "edit" && t.value !== form.type;
            // A preset also selects `smart_filter`, but it is the preset that
            // is chosen — showing both highlighted would claim two answers to
            // one question.
            const selected = form.type === t.value && !form.cleanupPreset;
            return (
              <button
                key={t.value}
                type="button"
                className={`${styles.typeCard} ${selected ? styles.typeCardSelected : ""}`}
                onClick={() => setForm({ ...form, type: t.value, cleanupPreset: undefined })}
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

  /**
   * "This rule will build about N collections", and a warning when N is a
   * number nobody meant to ask for.
   *
   * Sits under the min-items field because raising that floor is the fix, and
   * the estimate re-reads as you type it — the number moving is what makes the
   * connection. Non-blocking on purpose: a user who genuinely wants a
   * collection per production company is allowed to have one, they just
   * shouldn't get there by accident.
   */
  function renderVolumeEstimate() {
    if (!volume) return null;
    const noun = groupNounForType(form.type);
    const count = approximateCount(volume.estimate);
    const items = volume.libraryItems.toLocaleString();

    if (volume.level === "ok") {
      return (
        <p className={styles.hint}>
          Roughly <strong>{count}</strong> collections, one per {noun}, across {items} items.
        </p>
      );
    }

    const severe = volume.level === "severe";
    return (
      <div className={styles.volumePanel} data-tone={volume.level} role="status">
        <p className={styles.volumePanelHeading}>
          {severe ? `This will build around ${count} collections` : `That's around ${count} collections`}
        </p>
        <p className={styles.volumePanelBody}>
          One per {noun} across {items} items in the selected sections.{" "}
          {severe
            ? `Most of them will hold one or two titles, and building that many is enough Plex writes to make the server itself start refusing them mid-run.`
            : `The long tail of that is ${noun}s with one or two titles.`}{" "}
          {form.minItems > 0
            ? `Raise the minimum above ${form.minItems} to cut it down.`
            : `Switch on "Skip small collections" above to cut it down.`}
        </p>
        <p className={styles.volumePanelBody}>
          Estimated from your library size — the real number depends on your metadata, so treat it as an order of
          magnitude.
        </p>
      </div>
    );
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

        {renderVolumeEstimate()}

        {form.type === "rt_top_rated" && !omdbConfigured && (
          <p className={styles.hint}>Heads-up: OMDB API key is not configured in Settings → AI.</p>
        )}

        {/* A cleanup rule builds nothing to pin — see `rulePins`. The Outcome
            step comes first precisely so this block can be absent rather than
            retracted. */}
        {form.outcome.kind === "cleanup" && (
          <p className={styles.hint}>
            Cleanup rules build no collections at all, so there's nothing to pin. What matched is on the Cleanup queue
            here in Tinkerbell.
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

        {renderScheduleFields()}
      </>
    );
  }

  /**
   * "When does this run?" — three independent switches, all off by default.
   *
   * Lives at the foot of Scope rather than in a step of its own: it is the
   * same question Scope already asks (which slice of the library, and when)
   * and a fourth step for three checkboxes most rules never touch would be a
   * step everyone pages past.
   */
  function renderScheduleFields() {
    const s = form.schedule;
    const setSchedule = (patch: Partial<ScheduleFormState>) => setForm({ ...form, schedule: { ...s, ...patch } });

    return (
      <div className={styles.scheduleBlock}>
        <h4 className={styles.scheduleHeading}>When it runs</h4>
        <p className={styles.hint}>
          By default every rule runs in the nightly Generate job. These are for the ones that shouldn't.
        </p>

        <div className={styles.field}>
          <label>
            <input type="checkbox" checked={s.useCron} onChange={(e) => setSchedule({ useCron: e.target.checked })} />{" "}
            Run on its own schedule
          </label>
          {s.useCron && (
            <>
              <input
                type="text"
                className={shared.input}
                style={{ maxWidth: 200 }}
                value={s.cron}
                onChange={(e) => setSchedule({ cron: e.target.value })}
                aria-label="Cron expression"
                placeholder="0 3 * * *"
              />
              <label>
                <input
                  type="checkbox"
                  checked={s.excludeFromBatch}
                  onChange={(e) => setSchedule({ excludeFromBatch: e.target.checked })}
                />{" "}
                And skip the nightly job
              </label>
              <CronPreview expr={s.cron} />
              <span className={styles.hint}>
                A cron expression, evaluated in the timezone set under Settings → Schedules.{" "}
                {s.excludeFromBatch
                  ? "This rule now runs only on this schedule."
                  : "This rule runs on this schedule as well as nightly."}
              </span>
            </>
          )}
        </div>

        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={s.useWindow}
              onChange={(e) => setSchedule({ useWindow: e.target.checked })}
            />{" "}
            Only during part of the year
          </label>
          {s.useWindow && (
            <>
              <div className={styles.scheduleDates}>
                <input
                  type="text"
                  className={shared.input}
                  value={s.activeFrom}
                  onChange={(e) => setSchedule({ activeFrom: e.target.value })}
                  aria-label="Active from (MM-DD)"
                  placeholder="MM-DD"
                />
                <span className={styles.hint}>to</span>
                <input
                  type="text"
                  className={shared.input}
                  value={s.activeTo}
                  onChange={(e) => setSchedule({ activeTo: e.target.value })}
                  aria-label="Active to (MM-DD)"
                  placeholder="MM-DD"
                />
              </div>
              <span className={styles.hint}>
                {describeRuleWindow({ activeFrom: s.activeFrom, activeTo: s.activeTo })
                  ? `Runs ${describeRuleWindow({ activeFrom: s.activeFrom, activeTo: s.activeTo })} each year. Outside that, its collections are removed and put back when the window comes round again.`
                  : "Two dates as MM-DD. An end before the start wraps the year end, so 12-01 to 01-05 is Christmas."}
              </span>
            </>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Also run when…</span>
          {RULE_TRIGGERS.map((trigger) => (
            <label key={trigger}>
              <input
                type="checkbox"
                checked={s.triggers.includes(trigger)}
                onChange={(e) =>
                  setSchedule({
                    triggers: e.target.checked ? [...s.triggers, trigger] : s.triggers.filter((t) => t !== trigger),
                  })
                }
              />{" "}
              {RULE_TRIGGER_LABELS[trigger]}
              <span className={styles.hint}>{RULE_TRIGGER_NOTES[trigger]}</span>
            </label>
          ))}
          <span className={styles.hint}>
            Each trigger rides on the job that already knows the answer, so it inherits that job's cadence rather than
            firing the instant something happens. The nightly run still happens either way.
          </span>
        </div>

        {/* Chaining. Deliberately below the triggers: it is the same idea —
            "run because something happened" — where the something is another
            rule finishing. */}
        <div className={styles.field}>
          <span className={styles.label}>Run after these rules</span>
          <MultiSelect
            allLabel="Nothing — run on its own"
            ariaLabel="Rules this one runs after"
            options={chainableRules}
            selected={s.afterRules}
            onChange={(afterRules) => setSchedule({ afterRules })}
          />
          <span className={styles.hint}>
            For two-stage curation: one rule builds a pool, this one curates it. Only applies when the upstream rule
            runs <em>outside</em> the nightly batch — on its own cron, or from a trigger. Inside the batch the rule
            order on the Rules page already decides this.
          </span>
        </div>
      </div>
    );
  }

  /**
   * "What should happen to matches?" — the cleanup knobs.
   *
   * Only reached by a cleanup rule; the kind itself comes from the page the
   * wizard was opened on and is never asked. The confirmation panel at the
   * bottom spells out, in plain English, what one run will actually do — this
   * is the last screen where somebody can notice they've built a scheduled
   * deletion.
   */

  /**
   * What a metadata rule writes.
   *
   * Every input is a template, and the token list is right there rather than
   * in a help page — `{sortableTitle}` alone answers the complaint most people
   * arrive with, and nobody guesses a token vocabulary. The lock and
   * overwrite-locked switches are spelled out in full because both are choices
   * with consequences a user cannot see from the outside: an unlocked write is
   * reverted by the next agent refresh, and overwriting a locked field
   * discards somebody's deliberate fix.
   */
  function renderMetadataStep() {
    const o = form.outcome;
    const setOutcome = (patch: Partial<OutcomeFormState>) => setForm({ ...form, outcome: { ...o, ...patch } });
    const tokenError = (value: string) => (value ? templateError(value) : null);
    const usesSortableTitle = Object.values(o.set).some((v) => v.includes("{sortableTitle}"));

    return (
      <>
        <h3 className={styles.stepHeading}>What should this rule write?</h3>
        <p className={styles.stepSub}>
          Every matching item gets these fields. Leave a field blank to leave it alone. Values can use tokens —{" "}
          {METADATA_TOKENS.map((t) => `{${t}}`).join(", ")} — which are filled in per item.
        </p>

        {METADATA_SETTABLE_FIELDS.map((field) => {
          const error = tokenError(o.set[field]);
          return (
            <div key={field} className={styles.field}>
              <label htmlFor={`meta-set-${field}`}>{METADATA_FIELD_LABELS[field]}</label>
              <input
                id={`meta-set-${field}`}
                className={shared.input}
                value={o.set[field]}
                placeholder={METADATA_FIELD_PLACEHOLDERS[field]}
                onChange={(e) => setOutcome({ set: { ...o.set, [field]: e.target.value } })}
              />
              {error && <span className={styles.errorText}>{error}</span>}
            </div>
          );
        })}

        {usesSortableTitle && (
          <div className={styles.field}>
            <label htmlFor="meta-sort-languages">Languages whose leading articles to move</label>
            <input
              id="meta-sort-languages"
              className={shared.input}
              value={o.sortLanguages.join(", ")}
              placeholder="en"
              onChange={(e) =>
                setOutcome({
                  sortLanguages: e.target.value
                    .split(",")
                    .map((v) => v.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
            />
            <span className={styles.hint}>
              Two-letter codes, comma separated. Supported: {Object.keys(SORT_ARTICLES).join(", ")}. Only add a language
              your library actually contains — stripping "La" is right in a French library and wrong for "La Bamba" in
              an English one.
            </span>
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor="meta-add-genres">Genres to add</label>
          <input
            id="meta-add-genres"
            className={shared.input}
            value={o.addGenres.join(", ")}
            placeholder="Cyberpunk, Neo-noir"
            onChange={(e) => setOutcome({ addGenres: splitTags(e.target.value) })}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="meta-add-labels">Labels to add</label>
          <input
            id="meta-add-labels"
            className={shared.input}
            value={o.addLabels.join(", ")}
            placeholder="Curated"
            onChange={(e) => setOutcome({ addLabels: splitTags(e.target.value) })}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="meta-remove-genres">Genres to remove</label>
          <input
            id="meta-remove-genres"
            className={shared.input}
            value={o.removeGenres.join(", ")}
            onChange={(e) => setOutcome({ removeGenres: splitTags(e.target.value) })}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="meta-remove-labels">Labels to remove</label>
          <input
            id="meta-remove-labels"
            className={shared.input}
            value={o.removeLabels.join(", ")}
            onChange={(e) => setOutcome({ removeLabels: splitTags(e.target.value) })}
          />
        </div>

        <div className={styles.field}>
          <label>
            <input type="checkbox" checked={o.lock} onChange={(e) => setOutcome({ lock: e.target.checked })} /> Lock the
            fields this rule writes
          </label>
          <span className={styles.hint}>
            A locked field stops receiving updates from Plex's metadata agents, so the value survives the next scan.
            Unlocked, Plex may put its own value back on the next refresh — which looks exactly like the rule working
            and then quietly undoing itself.
          </span>
        </div>

        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={o.overwriteLocked}
              onChange={(e) => setOutcome({ overwriteLocked: e.target.checked })}
            />{" "}
            Overwrite fields somebody has already locked
          </label>
          <span className={styles.hint}>
            Off by default. A locked field holding a different value is almost always a deliberate fix — the rule skips
            it and says so in the run log.
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="meta-max-writes">Most fields to change per run</label>
          <input
            id="meta-max-writes"
            type="number"
            className={shared.input}
            style={{ maxWidth: 140 }}
            min={1}
            value={o.maxWritesPerRun}
            onChange={(e) => setOutcome({ maxWritesPerRun: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          />
          <span className={styles.hint}>
            A per-rule brake. There is a second, global one in Settings → Metadata that no rule can exceed.
          </span>
        </div>

        <div className={styles.field}>
          <label>
            <input type="checkbox" checked={o.dryRun} onChange={(e) => setOutcome({ dryRun: e.target.checked })} />{" "}
            Preview only — report what would change and write nothing
          </label>
          <span className={styles.hint}>
            On by default, and worth leaving on for a run or two. Metadata is the one thing here that can't be
            regenerated: run it, read the log, then switch this off.
          </span>
        </div>
      </>
    );
  }

  function renderPlaylistStep() {
    const o = form.outcome;
    const setOutcome = (patch: Partial<OutcomeFormState>) => setForm({ ...form, outcome: { ...o, ...patch } });

    return (
      <>
        <h3 className={styles.stepHeading}>How should the playlist look?</h3>
        <p className={styles.stepSub}>
          A playlist is an ordered list rather than a set, which is the whole reason to want one. It belongs to the Plex
          account Tinkerbell signs in as — the server owner — so everyone sharing this server sees the same one.
        </p>

        <div className={styles.field}>
          <label htmlFor="playlist-name">Name</label>
          <input
            id="playlist-name"
            className={shared.input}
            value={o.playlistName}
            onChange={(e) => setOutcome({ playlistName: e.target.value })}
            placeholder={form.name || "Defaults to the rule's name"}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="playlist-order">Order</label>
          <select
            id="playlist-order"
            className={shared.input}
            value={o.playlistOrder}
            onChange={(e) => setOutcome({ playlistOrder: e.target.value as OutcomeFormState["playlistOrder"] })}
          >
            <option value="handler">However the source lists them</option>
            <option value="release_date">Oldest first</option>
            <option value="added_date">Recently added first</option>
            <option value="title">Alphabetical</option>
            <option value="random">Shuffled</option>
          </select>
          <span className={styles.hint}>
            {o.playlistOrder === "handler"
              ? "Keeps the source's own order — for a list, that's the order it was written in, which is usually the point."
              : "Re-sorts whatever the source produced."}
          </span>
        </div>

        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={o.playlistCombineSections}
              onChange={(e) => setOutcome({ playlistCombineSections: e.target.checked })}
            />{" "}
            One playlist across every library
          </label>
          <span className={styles.hint}>
            Playlists aren't tied to a library, so this is usually what you want. Turn it off to get one playlist per
            library instead.
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="playlist-limit">Most items</label>
          <input
            id="playlist-limit"
            type="number"
            min={0}
            className={shared.input}
            value={o.playlistLimit || ""}
            onChange={(e) => setOutcome({ playlistLimit: Number(e.target.value) || 0 })}
            placeholder="No limit"
          />
          <span className={styles.hint}>Applied after ordering, so a cap keeps the front of the list.</span>
        </div>
      </>
    );
  }

  function renderOutcomeStep() {
    const o = form.outcome;
    const setOutcome = (patch: Partial<OutcomeFormState>) => setForm({ ...form, outcome: { ...o, ...patch } });
    const destructive = isDestructiveMode(o.mode);

    if (o.kind === "metadata") return renderMetadataStep();
    if (o.kind === "playlist") return renderPlaylistStep();

    return (
      <>
        <h3 className={styles.stepHeading}>What should happen to matches?</h3>
        <p className={styles.stepSub}>
          Matching items are tracked over several runs, then labelled, unmonitored, or deleted. Nothing is written to
          Plex until then — what matched shows up on the Cleanup queue here, where you can keep or protect it.
        </p>

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
                <option value="collection_only">Queue only — track matches, change nothing</option>
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
                Leave this on until you've run the rule and read the log. The queue fills up either way.
              </span>
            </div>

            {/* Only meaningful for a rule that actually removes something, and
                only once it is live: an approval queue for a preview run is a
                queue of decisions with no consequences. */}
            {destructive && !o.dryRun && (
              <div className={styles.field}>
                <label>
                  <input
                    type="checkbox"
                    checked={o.requireApproval}
                    onChange={(e) => setOutcome({ requireApproval: e.target.checked })}
                  />{" "}
                  Ask me before removing each item
                </label>
                <span className={styles.hint}>
                  Items still build their streak and still reach the queue; nothing is {o.mode}d until you approve it
                  there. The streak protects against a metadata blip — this protects against a filter that is
                  consistently wrong, which looks exactly as confident on run three as on run one.
                </span>
              </div>
            )}

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
                  {o.requireApproval && "Each item waits for your approval on the Cleanup page first. "}
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

  /**
   * "What should these collections look like?"
   *
   * The poster half defaults to off and stays off until someone looks at the
   * preview and says yes — uploading artwork is a visible, hard-to-undo change
   * to their Plex server. The summary half defaults to on, because a templated
   * sentence is deterministic, free, and additive.
   */
  function renderPresentationStep() {
    const p = form.presentation;
    const setPresentation = (patch: Partial<PresentationFormState>) =>
      setForm({ ...form, presentation: { ...p, ...patch } });

    const sampleTitle = form.name.trim() || suggestName(form, sections) || sampleCollectionName(form.type);
    const sectionType = availableSections.find((s) => form.sections.includes(s.title))?.type;
    const defaultPosterTemplate = (configQuery.data?.collection_art_default_template ??
      "gradient") as PresentationFormState["poster"];

    return (
      <>
        <h3 className={styles.stepHeading}>How should these collections look?</h3>
        <p className={styles.stepSub}>
          Plex shows a collection with no artwork as a grey grid of its first four posters, and no description at all.
          This is where that stops being true.
        </p>

        <div className={styles.field}>
          <label htmlFor="presentation-summary">Description</label>
          <select
            id="presentation-summary"
            className={shared.input}
            value={p.summary}
            onChange={(e) => setPresentation({ summary: e.target.value as PresentationFormState["summary"] })}
          >
            <option value="template">Written from the rule (recommended)</option>
            <option value="llm">Written by AI from what's in the collection</option>
            <option value="custom">The same sentence on every collection</option>
            <option value="none">None</option>
          </select>
          <span className={styles.hint}>
            {p.summary === "template"
              ? templatedSummaryHint(form.type, sampleTitle, sectionType)
              : p.summary === "llm"
                ? "Costs one AI call per collection, once, and is reused until the rule changes. Needs a provider in Settings → AI; without one the templated sentence is used instead."
                : p.summary === "custom"
                  ? "Every collection this rule builds gets the same text — right for a single-collection rule, repetitive for a grouped one."
                  : "Collections are left with no description."}
          </span>
        </div>

        {p.summary === "custom" && (
          <div className={styles.field}>
            <label htmlFor="presentation-custom-summary">Summary text</label>
            <textarea
              id="presentation-custom-summary"
              className={shared.input}
              rows={3}
              maxLength={1000}
              value={p.customSummary}
              onChange={(e) => setPresentation({ customSummary: e.target.value })}
            />
          </div>
        )}

        {/* Two controls rather than one select with a "none" option: turning
            artwork on is the decision that writes to somebody's Plex server,
            and it deserves to look like a decision. Switching it on takes the
            template from Settings → Appearance, so that default means
            something rather than sitting there unread. */}
        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={p.poster !== "none"}
              onChange={(e) => setPresentation({ poster: e.target.checked ? defaultPosterTemplate : "none" })}
            />{" "}
            Generate a poster for these collections
          </label>
          <span className={styles.hint}>
            {p.poster === "none"
              ? "Off by default on purpose: uploading artwork changes what everyone with access to your server sees, and Plex has no undo for it."
              : "Generated on the server and uploaded by the Generate Collection Artwork job, which runs after the nightly rule run rather than inside it."}
          </span>
        </div>

        {p.poster !== "none" && (
          <div className={styles.field}>
            <label htmlFor="presentation-poster">Style</label>
            <select
              id="presentation-poster"
              className={shared.input}
              value={p.poster}
              onChange={(e) => setPresentation({ poster: e.target.value as PresentationFormState["poster"] })}
            >
              <option value="gradient">Gradient — a coloured plate with the title</option>
              <option value="mosaic">Mosaic — a grid of the collection's own posters</option>
              <option value="spotlight">Spotlight — one member's poster, framed</option>
              <option value="url">A specific image</option>
              <option value="asset">A file from the asset directory</option>
            </select>
            {p.poster === "asset" && (
              <span className={styles.hint}>
                Looks each collection up by name in the asset directory set in Settings → Appearance, the way Kometa
                does. Collections with no matching file keep the poster they already have.
              </span>
            )}
            {p.poster === "url" && (
              <span className={styles.hint}>
                Fetched by the server on a schedule, so it has to be HTTPS on a known image host.
              </span>
            )}
          </div>
        )}

        {p.poster === "url" && (
          <div className={styles.field}>
            <label htmlFor="presentation-poster-url">Poster URL</label>
            <input
              id="presentation-poster-url"
              className={shared.input}
              value={p.posterUrl}
              onChange={(e) => setPresentation({ posterUrl: e.target.value })}
              placeholder="https://raw.githubusercontent.com/…"
            />
          </div>
        )}

        {p.poster !== "none" && p.poster !== "url" && (
          <div className={styles.field}>
            <label htmlFor="presentation-accent">Accent colour</label>
            <input
              id="presentation-accent"
              className={shared.input}
              style={{ maxWidth: 200 }}
              value={p.accentColor}
              onChange={(e) => setPresentation({ accentColor: e.target.value })}
              placeholder="Leave blank to derive it"
            />
            <span className={styles.hint}>
              Blank takes the colour from the collection's own posters, which is what makes a generated set look like it
              belongs to the films rather than to a theme.
            </span>
          </div>
        )}

        {p.poster !== "none" && configQuery.data?.collection_art_enabled === false && (
          <p className={styles.hint}>
            Heads-up: collection artwork is switched off globally in Settings → Appearance, so nothing will be uploaded
            until that's turned back on.
          </p>
        )}

        {p.poster !== "none" && (
          <div className={styles.field}>
            <label>Preview</label>
            <CollectionPosterPreview
              title={sampleTitle}
              presentation={{
                summary: p.summary,
                customSummary: p.customSummary || undefined,
                poster: p.poster,
                posterUrl: p.posterUrl || undefined,
                accentColor: p.accentColor || undefined,
              }}
              sectionId={tagSectionId}
              sectionType={sectionType}
              ruleType={form.type}
              enabled={!presentationError(form)}
            />
            <span className={styles.hint}>
              A real render, using art from your library. A grouped rule builds one of these per{" "}
              {groupNounForType(form.type)}, so this is the layout rather than the exact collection.
            </span>
          </div>
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
            {/* Only shown once there is a choice to make. On the single-instance
                setup almost everyone has, a picker with one entry is a control
                that asks a question with one answer. */}
            {arrInstancesForService.length > 1 && (
              <div className={styles.field}>
                <label htmlFor="arr-instance">Instance</label>
                <select
                  id="arr-instance"
                  className={shared.input}
                  value={form.arr.instanceId ?? ""}
                  onChange={(e) =>
                    // Changing instance invalidates both — a profile id from
                    // one server means something else entirely on another.
                    setArr({ instanceId: e.target.value, qualityProfileId: 0, rootFolderPath: "" })
                  }
                >
                  {arrInstancesForService.map((i) => (
                    <option key={i.id} value={i.isDefault ? "" : i.id}>
                      {i.name}
                      {i.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
          {/* The last place the volume is visible before the rule is saved —
              the Scope step is several clicks back by now, and "about 5,000"
              is worth reading twice. */}
          {volume && (
            <div className={styles.summaryRow} data-tone={volume.level === "ok" ? undefined : volume.level}>
              <span className={styles.summaryLabel}>Collections</span>
              <span className={styles.summaryValue}>
                Roughly {approximateCount(volume.estimate)}
                {volume.level !== "ok" && " — more than most libraries want"}
              </span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("scope")}>
                Edit
              </button>
            </div>
          )}
          {/* Cleanup only: a collection rule's outcome is the one the page it
              was created on offers, and it has no step to edit it on. */}
          {form.outcome.kind === "cleanup" && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Outcome</span>
              <span className={styles.summaryValue}>{describeOutcome(form.outcome)}</span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("outcome")}>
                Edit
              </button>
            </div>
          )}
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
          {form.outcome.kind === "collection" && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Look</span>
              <span className={styles.summaryValue}>{describePresentation(form.presentation)}</span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("presentation")}>
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
    if (currentStep.id === "presentation") return renderPresentationStep();
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

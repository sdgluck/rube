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
  RULE_TRIGGER_CADENCE,
  METADATA_SETTABLE_FIELDS,
  SORT_ARTICLES,
  templateError,
  templatedCollectionSummary,
  rotatesPins,
  ruleCollectionCount,
  volumeLevel,
  type ArrService,
  type RuleSchedule,
} from "@tinkerbell/contracts";
import CollectionPosterPreview from "#components/CollectionPosterPreview";
import ColorField from "#components/ColorField";
import CronPreview from "#components/CronPreview";
import MultiSelect from "#components/MultiSelect";
import SchedulePicker from "#components/SchedulePicker";
import SettingsPageLink from "#components/SettingsPageLink";
import controls from "#/styles/controls.module.css";
import { EMPTY } from "#/format";
import { trpc } from "#/trpc";
import shared from "#/styles/shared.module.css";
import Modal from "#components/Modal";
import styles from "./RuleWizard.module.css";
import MonthDaySelect from "./MonthDaySelect.tsx";
import TemplateInput from "./TemplateInput.tsx";
import ArrTargetFields, { ARR_SERVICE_LABEL } from "./ArrTargetFields.tsx";
import { IMDB_CHART_LABELS, LIST_PROVIDER_LABELS, SEERR_FILTER_LABELS } from "./constants.ts";
import {
  arrServicesForSections,
  buildsOneCollection,
  collectionCountTag,
  defaultLimitForType,
  describeCollectionCount,
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
  type RuleType,
  type StepId,
} from "./rule-types.ts";
import { hasSourceStep, SOURCE_STEPS, type SourceStepType } from "./sources/index.ts";
import { buildPresetFilter, CLEANUP_PRESETS, type CleanupPreset } from "./cleanup-presets.ts";

import type {
  ArrFormState,
  ArrTargetForm,
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
  return example ? `e.g. "${example}"` : "Nothing to derive for this type; the AI option can describe it.";
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

/** "English — the, a, an": the language and exactly what it would move. */
const SORT_LANGUAGE_OPTIONS = (() => {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    // Older engines: the code alone still identifies the language.
  }
  return Object.entries(SORT_ARTICLES).map(([code, articles]) => ({
    value: code,
    label: `${names?.of(code) ?? code} — ${articles.join(", ")}`,
  }));
})();

/** Comma-separated tags, trimmed, with the blanks dropped. */
function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

type TypeRequirement = NonNullable<RuleType["requires"]>;

/** What an unconfigured rule type is missing, and the settings page that fixes it. */
const REQUIREMENTS: Record<TypeRequirement, { label: string; to: string }> = {
  omdb: { label: "an OMDb API key", to: "/settings/databases" },
  seerr: { label: "Seerr", to: "/settings/arrs" },
  tmdb: { label: "a TMDb API key", to: "/settings/databases" },
};

function RequirementLink({ requirement }: { requirement: TypeRequirement }) {
  const r = REQUIREMENTS[requirement];
  return (
    <span className={styles.typeCardWarn}>
      Needs {r.label} · <SettingsPageLink to={r.to} />
    </span>
  );
}

/**
 * What rotation does, said once for both places it can be switched on — the
 * many-collection types, where it's required, and the rest, where it's opt-in.
 */
function RotationHint({ count, whenOff }: { count: number; whenOff: string }) {
  return (
    <span className={styles.hint}>{count > 0 ? `${count} per library, a fresh random set each run.` : whenOff}</span>
  );
}

/** One line per mode, saying what it actually does rather than restating it. */
const CLEANUP_MODE_HINTS: Record<CleanupMode, string> = {
  collection_only: "Matches gather on the Cleanup queue; nothing changes.",
  label: "Adds a Tinkerbell:Cleanup label in Plex; nothing is removed.",
  unmonitor: "Keeps the files; stops Radarr/Sonarr re-grabbing them.",
  delete: "Removes the files from disk. There is no undo.",
};

// Re-export the public types so existing `import { ... } from "#pages/Rules/RuleWizard"`
// call sites keep working.
export { arrConfigFromForm, arrFormFromConfig } from "./arr-form.ts";
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
  const personalizationOn =
    trpc.personalization.status.useQuery(undefined, { staleTime: 60_000 }).data?.status === "enabled";
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });

  // Candidates for `afterRules`. Fetched only while the wizard is open —
  // everything else on this screen is local, and a list of every rule is not
  // worth holding for a panel most visits never scroll to. Self is excluded
  // here as well as in the runner: a rule offering to run after itself reads
  // as a feature rather than as the no-op it is.
  const rulesQuery = trpc.rules.list.useQuery(undefined, { enabled: open, staleTime: 30_000 });
  //
  // A chain only fires when the upstream rule runs outside the nightly batch,
  // so one with neither a cron nor a trigger is marked: inside the batch the
  // running order already decides which goes first.
  const chainableRules = useMemo(
    () =>
      (rulesQuery.data ?? [])
        .filter((r) => r.id !== form.id)
        .map((r) => {
          const schedule = (r.config as { schedule?: RuleSchedule } | null)?.schedule;
          const nightlyOnly = !schedule?.cron && !schedule?.triggers?.length;
          return { value: r.id, label: nightlyOnly ? `${r.name} (nightly — order decides)` : r.name };
        }),
    [rulesQuery.data, form.id],
  );
  const sections = sectionsQuery.data || [];

  const omdbConfigured = !!configQuery.data?.global_omdb_api_key;
  const seerrConfigured = !!(configQuery.data?.global_seerr_url && configQuery.data?.global_seerr_api_key);
  const tmdbConfigured = !!configQuery.data?.global_tmdb_api_key;

  // Whether any service this rule could send to is set up; the per-service
  // queries live in `ArrTargetFields`.
  const arrStatusQuery = trpc.arr.status.useQuery(undefined, { staleTime: 60_000 });

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
  // An empty selection means every available section, which is what the
  // Sections chips and the job both take it to mean.
  const scopedSections = useMemo(
    () =>
      form.sections.length > 0 ? availableSections.filter((s) => form.sections.includes(s.title)) : availableSections,
    [form.sections, availableSections],
  );

  // Films go to Radarr and shows to Sonarr, so the services on offer follow
  // the libraries in scope. Kept on the form (not just derived here) so
  // validation and saving see what the Actions step showed. Skipped until the
  // sections have loaded, or an edited rule would lose its targets to an
  // empty list on the first render.
  const arrServices = useMemo(() => arrServicesForSections(scopedSections.map((s) => s.type)), [scopedSections]);
  useEffect(() => {
    if (sections.length === 0) return;
    setForm((prev) =>
      prev.arr.services.join() === arrServices.join() ? prev : { ...prev, arr: { ...prev.arr, services: arrServices } },
    );
  }, [arrServices, sections.length]);

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
    const libraryItems = scopedSections.reduce((sum, s) => sum + (counts[s.title] ?? 0), 0);
    const estimate = estimateCollectionCount({
      type: form.type,
      libraryItems,
      minItems: form.minItems,
      limit: form.limit,
    });
    if (estimate === null) return null;
    return { estimate, libraryItems, level: volumeLevel(estimate) };
  }, [volumeMatters, itemCountsQuery.data, scopedSections, form.type, form.minItems, form.limit]);

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
    const configured: Record<TypeRequirement, boolean> = {
      omdb: omdbConfigured,
      seerr: seerrConfigured,
      tmdb: tmdbConfigured,
    };

    return (
      <>
        <h3 className={styles.stepHeading}>{heading}</h3>
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
            <p className={styles.subLabel}>Or select the items yourself:</p>
          </>
        )}
        <div className={styles.typeGrid}>
          {types.map((t) => {
            const missing = t.requires && !configured[t.requires] ? t.requires : null;
            const disabled = mode === "edit" && t.value !== form.type;
            // A preset also selects `smart_filter`, but it is the preset that
            // is chosen — showing both highlighted would claim two answers to
            // one question.
            const selected = form.type === t.value && !form.cleanupPreset;
            // An unconfigured type is not a button: picking it would build a
            // rule that fails every run, and a link to the fix can't live
            // inside a <button>. A rule being edited keeps its own card.
            if (missing && !selected) {
              return (
                <div key={t.value} className={`${styles.typeCard} ${styles.typeCardUnavailable}`}>
                  <span className={styles.typeCardName}>{t.label}</span>
                  <span className={styles.typeCardDesc}>{t.description}</span>
                  {kind === "collection" && <span className={styles.typeCardCount}>{collectionCountTag(t.value)}</span>}
                  <RequirementLink requirement={missing} />
                </div>
              );
            }
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
                {kind === "collection" && <span className={styles.typeCardCount}>{collectionCountTag(t.value)}</span>}
                {missing && <span className={styles.typeCardWarn}>Needs {REQUIREMENTS[missing].label}</span>}
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
          One per {noun} across {items} items
          {severe ? ", mostly with one or two titles — enough writes for Plex to start refusing them." : "."}{" "}
          {form.minItems > 0 && `Raise the minimum above ${form.minItems} to cut it down.`}
        </p>
        {form.minItems === 0 && (
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
            onClick={() => setForm({ ...form, minItems: defaultMinItemsForType(form.type) })}
          >
            Skip small collections
          </button>
        )}
      </div>
    );
  }

  function renderScopeStep() {
    // The pin options talk about "it" or "them", and rotation only appears
    // where a library can hold more than one of the rule's collections —
    // rotating one collection pins it every time.
    const pinsOne = buildsOneCollection(form.type, form.limit, scopedSections.length);
    const pinsRotate = rotatesPins(ruleCollectionCount(form.type, form.limit));
    return (
      <>
        <h3 className={styles.stepHeading}>Scope</h3>

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
            {(() => {
              const hint = sectionsLocked
                ? "Set by the chosen chart."
                : form.type === "seerr_requests"
                  ? "Only the first selected section is used."
                  : form.sections.length === 0
                    ? "None selected means all of them."
                    : null;
              return hint && <span className={styles.hint}>{hint}</span>;
            })()}
          </div>
        ) : requiredSectionType && sections.length > 0 ? (
          <div className={styles.field}>
            <label>Sections</label>
            <span className={styles.hint}>
              No {requiredSectionType === "movie" ? "Movie" : "TV"} sections in your Plex library.
            </span>
          </div>
        ) : null}

        {/* Said before any option, and live: picking a second library or
            raising an AI prompt's count changes the answer as you watch. */}
        {form.outcome.kind === "collection" && (
          <p className={styles.collectionCount}>
            {describeCollectionCount(
              form.type,
              form.limit,
              scopedSections.map((s) => s.title),
            )}
          </p>
        )}

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
                  style={{ maxWidth: "14rem" }}
                  min={1}
                  value={form.limit}
                  onChange={(e) => setForm({ ...form, limit: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  aria-label={limitFieldLabel(form.type)}
                />
              )}
              {form.limit > 0 && <span className={styles.hint}>Keeps the largest {form.limit} per library.</span>}
            </div>
          ) : (
            <div className={styles.field}>
              <label htmlFor="rule-limit">{limitFieldLabel(form.type)}</label>
              <input
                id="rule-limit"
                type="number"
                className={shared.input}
                style={{ maxWidth: "14rem" }}
                min={1}
                value={form.limit}
                onChange={(e) =>
                  setForm({
                    ...form,
                    limit: Math.max(1, parseInt(e.target.value, 10) || 1),
                  })
                }
              />
              {typeProducesManyCollections(form.type) && (
                <span className={styles.hint}>A TMDb fetch budget per run, not a collection cap.</span>
              )}
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
                style={{ maxWidth: "14rem" }}
                min={1}
                value={form.minItems}
                onChange={(e) => setForm({ ...form, minItems: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                aria-label="Minimum items per collection"
              />
            )}
            {form.minItems > 0 && (
              <span className={styles.hint}>
                Only {groupNounForType(form.type)}s with {form.minItems}+ items get a collection.
              </span>
            )}
          </div>
        )}

        {renderVolumeEstimate()}

        {form.type === "rt_top_rated" && !omdbConfigured && (
          <div className={styles.field}>
            <RequirementLink requirement="omdb" />
          </div>
        )}

        {/* A cleanup rule builds nothing to pin — see `rulePins` — so the
            pin block is simply absent for one. */}

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
                {pinsOne ? "Pin the collection to the homepage" : "Pin its collections to the homepage"}
              </label>
            </div>

            {form.pinToHomepage && typeProducesManyCollections(form.type) && (
              <div className={styles.field}>
                <label htmlFor="rule-pin-rotation">Collections on the homepage at a time</label>
                <input
                  id="rule-pin-rotation"
                  type="number"
                  className={shared.input}
                  style={{ maxWidth: "14rem" }}
                  min={1}
                  value={form.pinRotationCount || ""}
                  onChange={(e) =>
                    setForm({ ...form, pinRotationCount: Math.max(0, parseInt(e.target.value, 10) || 0) })
                  }
                />
                <RotationHint
                  count={form.pinRotationCount}
                  whenOff="Required — this type builds more than a homepage can show."
                />
              </div>
            )}

            {form.pinToHomepage && !typeProducesManyCollections(form.type) && pinsRotate && (
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
                    style={{ maxWidth: "14rem" }}
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
                <RotationHint count={form.pinRotationCount} whenOff="Off pins every collection." />
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
                  {pinsOne ? "Only pin it if it has enough items" : "Only pin collections with enough items"}
                </label>
                {form.pinMinItems > 0 && (
                  <input
                    type="number"
                    className={shared.input}
                    style={{ maxWidth: "14rem" }}
                    min={1}
                    value={form.pinMinItems}
                    onChange={(e) => setForm({ ...form, pinMinItems: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    aria-label="Minimum items to pin a collection"
                  />
                )}
                {form.pinMinItems > 0 && (
                  <span className={styles.hint}>
                    {pinsOne ? "It's still built, just not pinned." : "Smaller ones are still built, just not pinned."}
                  </span>
                )}
              </div>
            )}

            <div className={styles.field}>
              <label>
                <input
                  type="checkbox"
                  checked={form.personalizable}
                  onChange={(e) => setForm({ ...form, personalizable: e.target.checked })}
                />{" "}
                Personalizable
              </label>
              <span className={styles.hint}>
                {personalizationOn
                  ? "Every run of this rule also builds a copy for each opted-in user, shaped by their tastes and pinned to their home screen."
                  : "Takes effect once Personalized Home Screens is on (Settings › Portal › Personalization)."}
              </span>
            </div>
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
        <p className={styles.hint}>Every rule runs nightly unless set otherwise here.</p>

        <div className={styles.field}>
          <label>
            <input type="checkbox" checked={s.useCron} onChange={(e) => setSchedule({ useCron: e.target.checked })} />{" "}
            Run on its own schedule
          </label>
          {s.useCron && (
            <>
              {/* No Manual (a rule is run by hand from its row) and no seconds:
                  rule crons are checked once a minute by Run Scheduled Rules. */}
              <SchedulePicker
                value={s.cron}
                onChange={(cron) => setSchedule({ cron })}
                kinds={["daily", "weekly", "interval", "custom"]}
              />
              <CronPreview expr={s.cron} />
              <label>
                <input
                  type="checkbox"
                  checked={s.excludeFromBatch}
                  onChange={(e) => setSchedule({ excludeFromBatch: e.target.checked })}
                />{" "}
                And skip the nightly job
              </label>
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
                <MonthDaySelect
                  value={s.activeFrom}
                  onChange={(activeFrom) => setSchedule({ activeFrom })}
                  label="Active from"
                />
                <span className={styles.hint}>to</span>
                <MonthDaySelect
                  value={s.activeTo}
                  onChange={(activeTo) => setSchedule({ activeTo })}
                  label="Active to"
                />
              </div>
              {describeRuleWindow({ activeFrom: s.activeFrom, activeTo: s.activeTo }) && (
                <span className={styles.hint}>
                  Runs {describeRuleWindow({ activeFrom: s.activeFrom, activeTo: s.activeTo })} each year; its
                  collections are removed outside it.
                </span>
              )}
            </>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Also run when…</span>
          {RULE_TRIGGERS.map((trigger) => (
            <label key={trigger} title={RULE_TRIGGER_NOTES[trigger]}>
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
              <span className={styles.cadence}>{RULE_TRIGGER_CADENCE[trigger]}</span>
            </label>
          ))}
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
          <span className={styles.hint}>Runs when these finish.</span>
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
        <p className={styles.hint}>Blank fields are left alone.</p>

        {METADATA_SETTABLE_FIELDS.map((field) => {
          const error = tokenError(o.set[field]);
          return (
            <div key={field} className={styles.field}>
              <label htmlFor={`meta-set-${field}`}>{METADATA_FIELD_LABELS[field]}</label>
              <TemplateInput
                id={`meta-set-${field}`}
                value={o.set[field]}
                placeholder={METADATA_FIELD_PLACEHOLDERS[field]}
                onChange={(value) => setOutcome({ set: { ...o.set, [field]: value } })}
              />
              {error && <span className={styles.errorText}>{error}</span>}
            </div>
          );
        })}

        {usesSortableTitle && (
          <div className={styles.field}>
            <span className={styles.label}>Languages whose leading articles to move</span>
            <MultiSelect
              allLabel="No languages"
              ariaLabel="Languages whose leading articles to move"
              options={SORT_LANGUAGE_OPTIONS}
              selected={o.sortLanguages}
              onChange={(sortLanguages) => setOutcome({ sortLanguages })}
            />
            <span className={styles.hint}>Only languages your library contains — "La Bamba" isn't French.</span>
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
          <span className={styles.hint}>Unlocked, Plex's next refresh may put its own value back.</span>
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
          <span className={styles.hint}>A locked field is usually someone's deliberate fix.</span>
        </div>

        <div className={styles.field}>
          <label htmlFor="meta-max-writes">Most fields to change per run</label>
          <input
            id="meta-max-writes"
            type="number"
            className={shared.input}
            style={{ maxWidth: "14rem" }}
            min={1}
            value={o.maxWritesPerRun}
            onChange={(e) => setOutcome({ maxWritesPerRun: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          />
          <span className={styles.hint}>
            Can't exceed the global cap in <SettingsPageLink to="/settings/metadata" />.
          </span>
        </div>

        <div className={styles.field}>
          <label>
            <input type="checkbox" checked={o.dryRun} onChange={(e) => setOutcome({ dryRun: e.target.checked })} />{" "}
            Preview only — report what would change and write nothing
          </label>
          <span className={styles.hint}>Leave on until the run log looks right.</span>
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

        <div className={styles.field}>
          <label htmlFor="playlist-name">Name</label>
          <input
            id="playlist-name"
            className={shared.input}
            value={o.playlistName}
            onChange={(e) => setOutcome({ playlistName: e.target.value })}
            placeholder={form.name || "Defaults to the rule's name"}
          />
          <span className={styles.hint}>Owned by the server account, so everyone sees the same one.</span>
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
          {o.playlistOrder === "handler" && (
            <span className={styles.hint}>For a list, the order it was written in.</span>
          )}
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
          <span className={styles.hint}>Off makes one playlist per library.</span>
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
          <span className={styles.hint}>Applied after ordering.</span>
        </div>
      </>
    );
  }

  function renderOutcomeStep() {
    const o = form.outcome;
    const setOutcome = (patch: Partial<OutcomeFormState>) => setForm({ ...form, outcome: { ...o, ...patch } });
    const destructive = isDestructiveMode(o.mode);
    const cleanupEnabled = configQuery.data?.cleanup_enabled === true;

    if (o.kind === "metadata") return renderMetadataStep();
    if (o.kind === "playlist") return renderPlaylistStep();

    return (
      <>
        <h3 className={styles.stepHeading}>What should happen to matches?</h3>

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
              <span className={styles.hint}>A miss resets the streak.</span>
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
                    Delete through Radarr/Sonarr <span className={styles.recommended}>Recommended</span>
                  </label>
                  <span className={styles.hint}>Otherwise Radarr/Sonarr re-downloads the file.</span>
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
                  <span className={styles.hint}>Stops lists re-adding it; undone by hand in Radarr/Sonarr.</span>
                </div>
              </>
            )}

            <div className={styles.field}>
              <label>
                <input type="checkbox" checked={o.dryRun} onChange={(e) => setOutcome({ dryRun: e.target.checked })} />{" "}
                Preview only — don't touch anything yet
              </label>
              <span className={styles.hint}>Leave on until the run log looks right.</span>
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
                <span className={styles.hint}>Nothing is {o.mode}d until you approve it on the queue.</span>
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
                  <span className={cleanupEnabled ? styles.chipOn : styles.chipOff}>
                    Cleanup: {cleanupEnabled ? "on" : "off"} globally
                  </span>{" "}
                  <SettingsPageLink to="/settings/cleanup">{cleanupEnabled ? "Settings" : "Turn on"}</SettingsPageLink>
                </p>
                <ul className={styles.dangerPanelList}>
                  <li>Skipped if the library hasn't synced in two days.</li>
                  <li>Skipped if it suddenly matches over a quarter of the library.</li>
                </ul>
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
          {p.summary === "template" ? (
            <span className={styles.hint}>{templatedSummaryHint(form.type, sampleTitle, sectionType)}</span>
          ) : p.summary === "llm" ? (
            <span className={styles.hint}>
              One AI call per collection, using the <SettingsPageLink to="/settings/ai">AI provider</SettingsPageLink>.
            </span>
          ) : p.summary === "custom" ? (
            <span className={styles.hint}>Same text on every collection.</span>
          ) : null}
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
          {p.poster === "none" ? (
            <span className={styles.hint}>Everyone on the server sees it, and Plex has no undo.</span>
          ) : (
            configQuery.data?.collection_art_enabled === false && (
              <span className={styles.chipOff}>
                Artwork is off globally · <SettingsPageLink to="/settings/appearance">Turn on</SettingsPageLink>
              </span>
            )
          )}
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
                Matched by name in the <SettingsPageLink to="/settings/appearance">asset directory</SettingsPageLink>.
              </span>
            )}
            {p.poster === "url" && <span className={styles.hint}>HTTPS, on a known image host.</span>}
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
            <ColorField
              id="presentation-accent"
              value={p.accentColor}
              onChange={(accentColor) => setPresentation({ accentColor })}
            />
          </div>
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
            {typeProducesManyCollections(form.type) && (
              <span className={styles.hint}>One per {groupNounForType(form.type)}; this shows the layout.</span>
            )}
          </div>
        )}
      </>
    );
  }

  function renderActionsStep() {
    const services = form.arr.services;
    const anyConfigured = services.some((svc) => !!arrStatusQuery.data?.[svc]);
    const setArr = (patch: Partial<ArrFormState>) => setForm({ ...form, arr: { ...form.arr, ...patch } });
    const setTarget = (svc: ArrService) => (patch: Partial<ArrTargetForm>) =>
      setForm({ ...form, arr: { ...form.arr, [svc]: { ...form.arr[svc], ...patch } } });

    if (services.length === 0) {
      return (
        <>
          <h3 className={styles.stepHeading}>Send missing items</h3>
          <span className={styles.hint}>None of the selected libraries hold films or TV.</span>
        </>
      );
    }

    return (
      <>
        <h3 className={styles.stepHeading}>
          Send missing items to {services.map((svc) => ARR_SERVICE_LABEL[svc]).join(" and ")}
        </h3>

        <div className={styles.field}>
          <label>
            <input
              type="checkbox"
              checked={form.arr.enabled}
              onChange={(e) => setArr({ enabled: e.target.checked })}
              disabled={!anyConfigured && !form.arr.enabled}
            />{" "}
            Enable
          </label>
        </div>

        {services.map((svc) => (
          <ArrTargetFields
            key={svc}
            service={svc}
            value={form.arr[svc]}
            onChange={setTarget(svc)}
            active={form.arr.enabled}
            titled={services.length > 1}
          />
        ))}

        {form.arr.enabled && (
          <>
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
              <span className={styles.hint}>Off waits for the next scheduled search.</span>
            </div>

            <div className={styles.field}>
              <label htmlFor="arr-cap">Max adds per run</label>
              <input
                id="arr-cap"
                type="number"
                className={shared.input}
                style={{ maxWidth: "14rem" }}
                min={1}
                max={500}
                value={form.arr.maxAddsPerRun}
                onChange={(e) =>
                  setArr({ maxAddsPerRun: Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)) })
                }
              />
              <span className={styles.hint}>Extras are skipped until the next run.</span>
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
              <span className={styles.hint}>Leave on until the run log looks right.</span>
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
          {!volume && form.outcome.kind === "collection" && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Collections</span>
              <span className={styles.summaryValue}>
                {describeCollectionCount(
                  form.type,
                  form.limit,
                  scopedSections.map((s) => s.title),
                )}
              </span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("scope")}>
                Edit
              </button>
            </div>
          )}
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
                  ? `${form.arr.services.map((svc) => ARR_SERVICE_LABEL[svc]).join(" + ")}${form.arr.dryRun ? " (dry run)" : ""}, max ${form.arr.maxAddsPerRun}/run`
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

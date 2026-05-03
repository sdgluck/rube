import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "./trpc";
import shared from "./pages/Collections.module.css";
import styles from "./RuleWizard.module.css";

export interface RuleFormState {
  id?: string;
  name: string;
  type: string;
  prompt: string;
  limit: number;
  minItems: number;
  sections: string[];
  chart: string;
  listId: string;
  filter: string;
}

interface RuleWizardProps {
  open: boolean;
  mode: "create" | "edit";
  initial: RuleFormState;
  saving: boolean;
  onSave: (form: RuleFormState) => void;
  onCancel: () => void;
}

interface RuleType {
  value: string;
  label: string;
  description: string;
  requires?: "omdb" | "seerr";
}

const RULE_TYPES: RuleType[] = [
  {
    value: "ai_prompt",
    label: "AI Prompt",
    description: "Generate collections from a custom AI prompt template applied to each section.",
  },
  {
    value: "top_rated",
    label: "Top Rated",
    description: "Group your highest-rated items in the library.",
  },
  {
    value: "lowest_rated",
    label: "Lowest Rated",
    description: "Group your lowest-rated items — useful as a 'maybe skip' shelf.",
  },
  {
    value: "actors",
    label: "Actors",
    description: "Build a collection per leading actor across your library.",
  },
  {
    value: "studios",
    label: "Studios",
    description: "Build a collection per studio.",
  },
  {
    value: "imdb_chart",
    label: "IMDb Chart",
    description: "Pull from IMDb charts like Top 250 Movies or Most Popular TV.",
  },
  {
    value: "imdb_list",
    label: "IMDb List",
    description: "Use any public IMDb list URL or list ID.",
  },
  {
    value: "rt_top_rated",
    label: "RT Top Rated",
    description: "Pull from Rotten Tomatoes top-rated items via OMDB.",
    requires: "omdb",
  },
  {
    value: "seerr_requests",
    label: "Seerr Requests",
    description: "Group items requested via Jellyseerr/Overseerr.",
    requires: "seerr",
  },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(RULE_TYPES.map((t) => [t.value, t.label]));

const IMDB_CHARTS = [
  { value: "top_250_movies", label: "Top 250 Movies", sectionType: "movie" as const },
  { value: "top_250_tv", label: "Top 250 TV Shows", sectionType: "show" as const },
  { value: "popular_movies", label: "Most Popular Movies", sectionType: "movie" as const },
  { value: "popular_tv", label: "Most Popular TV Shows", sectionType: "show" as const },
  { value: "box_office", label: "Box Office", sectionType: "movie" as const },
];

const IMDB_CHART_LABELS: Record<string, string> = Object.fromEntries(IMDB_CHARTS.map((c) => [c.value, c.label]));
const IMDB_CHART_SECTION_TYPE: Record<string, string> = Object.fromEntries(
  IMDB_CHARTS.map((c) => [c.value, c.sectionType]),
);

const SEERR_FILTERS = [
  { value: "all", label: "All Requests" },
  { value: "approved", label: "Approved" },
  { value: "available", label: "Available" },
  { value: "pending", label: "Pending" },
];

const SEERR_FILTER_LABELS: Record<string, string> = Object.fromEntries(SEERR_FILTERS.map((f) => [f.value, f.label]));

// ─── Type-driven config helpers ──────────────────────────────────────────

function defaultLimitForType(type: string): number {
  if (type === "ai_prompt") return 8;
  if (type === "top_rated" || type === "lowest_rated") return 50;
  if (type === "rt_top_rated") return 100;
  if (type === "seerr_requests") return 50;
  return 10;
}

function maxLimitForType(type: string): number {
  if (type === "ai_prompt") return 10;
  if (type === "top_rated" || type === "lowest_rated") return 200;
  if (type === "rt_top_rated") return 200;
  if (type === "seerr_requests") return 200;
  return 50;
}

function typeHasLimit(type: string): boolean {
  return type !== "imdb_chart" && type !== "imdb_list";
}

// Whether the wizard has a meaningful "source" step for this type.
function typeHasSourceStep(type: string): boolean {
  return type === "ai_prompt" || type === "imdb_chart" || type === "imdb_list" || type === "seerr_requests";
}

function limitFieldLabel(type: string): string {
  if (type === "ai_prompt") return "Collections per section";
  if (type === "top_rated" || type === "lowest_rated" || type === "rt_top_rated") return "Items per collection";
  return "Max collections";
}

function suggestName(form: RuleFormState, sections: { title: string }[]): string {
  if (form.type === "imdb_chart") return IMDB_CHART_LABELS[form.chart] || "IMDb Chart";
  if (form.type === "imdb_list") {
    const id = form.listId.match(/ls\d+/i)?.[0] || form.listId;
    return id ? `IMDb List ${id}` : "IMDb List";
  }
  if (form.type === "seerr_requests") return `Seerr — ${SEERR_FILTER_LABELS[form.filter] || "Requests"}`;
  if (form.type === "ai_prompt") {
    const firstLine = form.prompt.split(/\r?\n/)[0]?.trim() || "";
    return firstLine ? `AI: ${firstLine.slice(0, 40)}` : "AI Prompt";
  }
  if (form.type === "rt_top_rated") return "Rotten Tomatoes Top Rated";
  if (form.type === "top_rated") return "Top Rated";
  if (form.type === "lowest_rated") return "Lowest Rated";
  if (form.type === "actors") return "By Actor";
  if (form.type === "studios") return "By Studio";
  void sections;
  return "";
}

// ─── Step definitions ────────────────────────────────────────────────────

type StepId = "type" | "source" | "scope" | "review";

function stepsFor(type: string): { id: StepId; label: string }[] {
  const steps: { id: StepId; label: string }[] = [{ id: "type", label: "Type" }];
  if (typeHasSourceStep(type)) steps.push({ id: "source", label: "Source" });
  steps.push({ id: "scope", label: "Scope" });
  steps.push({ id: "review", label: "Review" });
  return steps;
}

// ─── Validation ──────────────────────────────────────────────────────────

function validateStep(step: StepId, form: RuleFormState): string | null {
  if (step === "type") return form.type ? null : "Pick a rule type.";
  if (step === "source") {
    if (form.type === "ai_prompt" && !form.prompt.trim()) return "Prompt is required.";
    if (form.type === "imdb_list" && !form.listId.trim()) return "An IMDb list ID or URL is required.";
    return null;
  }
  if (step === "scope") return null;
  if (step === "review") return form.name.trim() ? null : "Name is required.";
  return null;
}

function isFormValid(form: RuleFormState): boolean {
  return (
    !!form.name.trim() &&
    !!form.type &&
    (form.type !== "ai_prompt" || !!form.prompt.trim()) &&
    (form.type !== "imdb_list" || !!form.listId.trim())
  );
}

// ─── Component ───────────────────────────────────────────────────────────

export default function RuleWizard({ open, mode, initial, saving, onSave, onCancel }: RuleWizardProps) {
  const [form, setForm] = useState<RuleFormState>(initial);
  const [stepIdx, setStepIdx] = useState(mode === "edit" ? 0 : 0);
  const [exiting, setExiting] = useState(false);
  const [showError, setShowError] = useState(false);
  const nameTouchedRef = useRef(mode === "edit");
  const initialKeyRef = useRef<unknown>(null);

  const configQuery = trpc.config.get.useQuery(undefined, { staleTime: 60_000 });
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const sections = sectionsQuery.data || [];

  const omdbConfigured = !!configQuery.data?.global_omdb_api_key;
  const seerrConfigured = !!(configQuery.data?.global_seerr_url && configQuery.data?.global_seerr_api_key);

  const steps = useMemo(() => stepsFor(form.type), [form.type]);
  const currentStep = steps[Math.min(stepIdx, steps.length - 1)];

  // Reset state when the wizard is freshly opened (initial identity changed).
  useEffect(() => {
    if (!open) return;
    if (initialKeyRef.current === initial) return;
    initialKeyRef.current = initial;
    setForm(initial);
    setStepIdx(0);
    setShowError(false);
    setExiting(false);
    nameTouchedRef.current = mode === "edit" || !!initial.name.trim();
  }, [open, initial, mode]);

  // When type changes (create mode), reset limit to type default.
  useEffect(() => {
    if (mode === "edit") return;
    setForm((prev) => ({ ...prev, limit: defaultLimitForType(prev.type) }));
  }, [form.type, mode]);

  // Auto-lock sections when imdb_chart's chart implies a section type.
  const chartSectionType = form.type === "imdb_chart" ? IMDB_CHART_SECTION_TYPE[form.chart] : undefined;
  const sectionsLocked = !!chartSectionType;

  useEffect(() => {
    if (form.type !== "imdb_chart" || !chartSectionType || sections.length === 0) return;
    const locked = sections.filter((s) => s.type === chartSectionType).map((s) => s.title);
    setForm((prev) => ({ ...prev, sections: locked }));
  }, [form.type, form.chart, chartSectionType, sections]);

  // Auto-suggest name on entering review (create mode, untouched).
  useEffect(() => {
    if (currentStep?.id !== "review") return;
    if (mode === "edit") return;
    if (nameTouchedRef.current) return;
    const suggested = suggestName(form, sections);
    if (suggested && !form.name.trim()) {
      setForm((prev) => ({ ...prev, name: suggested }));
    }
  }, [currentStep?.id, mode, form.type, form.chart, form.listId, form.filter, form.prompt, sections]);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onCancel(), 200);
  }, [onCancel]);

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

  // Esc to close, Enter to advance (when not in textarea).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
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
  }, [open, goNext, handleClose]);

  if (!open) return null;

  const isLastStep = stepIdx === steps.length - 1;
  const primaryLabel = isLastStep ? (mode === "edit" ? "Save" : "Create") : "Next";
  const canPrimary = mode === "edit" ? isFormValid(form) : !stepError;

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
              t.requires === "seerr" && !seerrConfigured ? "Requires Jellyseerr/Overseerr (Settings → Arrs)" : null;
            const warn = missing || seerrMissing;
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

  function renderSourceStep() {
    if (form.type === "ai_prompt") {
      return (
        <>
          <h3 className={styles.stepHeading}>Prompt template</h3>
          <p className={styles.stepSub}>The prompt is sent to your AI provider once per included section.</p>
          <div className={styles.field}>
            <label htmlFor="rule-prompt">Prompt</label>
            <textarea
              id="rule-prompt"
              className={styles.textarea}
              value={form.prompt}
              onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              placeholder="Generate themed collections for {sectionTitle}..."
              autoFocus
            />
            <span className={styles.hint}>
              Available placeholders: {"{sectionTitle}"}, {"{limit}"}, {"{minItems}"}
            </span>
          </div>
          <div className={styles.field}>
            <label htmlFor="rule-min-items">Minimum items per collection</label>
            <input
              id="rule-min-items"
              type="number"
              className={shared.input}
              style={{ maxWidth: 140 }}
              min={1}
              max={100}
              value={form.minItems}
              onChange={(e) =>
                setForm({ ...form, minItems: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)) })
              }
            />
            <span className={styles.hint}>Collections with fewer matched items are skipped.</span>
          </div>
        </>
      );
    }

    if (form.type === "imdb_chart") {
      return (
        <>
          <h3 className={styles.stepHeading}>Pick a chart</h3>
          <p className={styles.stepSub}>The chart's media type also determines which sections are included.</p>
          <div className={styles.typeGrid}>
            {IMDB_CHARTS.map((c) => {
              const selected = form.chart === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  className={`${styles.typeCard} ${selected ? styles.typeCardSelected : ""}`}
                  onClick={() => setForm({ ...form, chart: c.value })}
                  aria-pressed={selected}
                >
                  <span className={styles.typeCardName}>{c.label}</span>
                  <span className={styles.typeCardDesc}>
                    Targets {c.sectionType === "movie" ? "Movie" : "TV"} sections.
                  </span>
                </button>
              );
            })}
          </div>
        </>
      );
    }

    if (form.type === "imdb_list") {
      return (
        <>
          <h3 className={styles.stepHeading}>IMDb list</h3>
          <p className={styles.stepSub}>Paste a public IMDb list URL or list ID.</p>
          <div className={styles.field}>
            <label htmlFor="rule-list-id">List URL or ID</label>
            <input
              id="rule-list-id"
              className={shared.input}
              value={form.listId}
              onChange={(e) => setForm({ ...form, listId: e.target.value })}
              placeholder="ls123456789 or https://www.imdb.com/list/ls123456789/"
              autoFocus
            />
          </div>
        </>
      );
    }

    if (form.type === "seerr_requests") {
      return (
        <>
          <h3 className={styles.stepHeading}>Which requests?</h3>
          <p className={styles.stepSub}>Filter the request set used to build this collection.</p>
          <div className={styles.field}>
            <label>Filter</label>
            <div className={styles.pills}>
              {SEERR_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`${styles.pill} ${form.filter === f.value ? styles.pillSelected : ""}`}
                  onClick={() => setForm({ ...form, filter: f.value })}
                  aria-pressed={form.filter === f.value}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {!seerrConfigured && (
            <p className={styles.hint}>Heads-up: Jellyseerr/Overseerr is not configured in Settings → Arrs.</p>
          )}
        </>
      );
    }

    return null;
  }

  function renderScopeStep() {
    return (
      <>
        <h3 className={styles.stepHeading}>Scope</h3>
        <p className={styles.stepSub}>
          Which Plex sections to apply this rule to{typeHasLimit(form.type) ? ", and how many items to include." : "."}
        </p>

        {sections.length > 0 && (
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
                      sections: form.sections.length === sections.length ? [] : sections.map((s) => s.title),
                    })
                  }
                >
                  {form.sections.length === sections.length ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            <div className={styles.sectionChips}>
              {sections.map((s) => {
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
                ? `Locked to ${chartSectionType === "movie" ? "Movie" : "TV"} sections by the chosen chart.`
                : form.sections.length === 0
                  ? "Default — applies to all sections."
                  : `${form.sections.length} selected.`}
            </span>
          </div>
        )}

        {typeHasLimit(form.type) && (
          <div className={styles.field}>
            <label htmlFor="rule-limit">{limitFieldLabel(form.type)}</label>
            <input
              id="rule-limit"
              type="number"
              className={shared.input}
              style={{ maxWidth: 140 }}
              min={1}
              max={maxLimitForType(form.type)}
              value={form.limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  limit: Math.max(1, Math.min(maxLimitForType(form.type), parseInt(e.target.value, 10) || 1)),
                })
              }
            />
            <span className={styles.hint}>Collections replace those generated in previous runs.</span>
          </div>
        )}

        {form.type === "rt_top_rated" && !omdbConfigured && (
          <p className={styles.hint}>Heads-up: OMDB API key is not configured in Settings → AI.</p>
        )}
      </>
    );
  }

  function jumpTo(id: StepId) {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIdx(idx);
  }

  function renderReviewStep() {
    const sectionsText =
      form.sections.length === 0
        ? "All sections"
        : form.sections.length === sections.length
          ? "All sections"
          : form.sections.join(", ");

    let sourceLabel: string | null = null;
    let sourceValue: string | null = null;
    if (form.type === "ai_prompt") {
      sourceLabel = "Prompt";
      const firstLine = form.prompt.split(/\r?\n/)[0]?.trim() || "";
      sourceValue = firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
    } else if (form.type === "imdb_chart") {
      sourceLabel = "Chart";
      sourceValue = IMDB_CHART_LABELS[form.chart] || form.chart;
    } else if (form.type === "imdb_list") {
      sourceLabel = "List";
      sourceValue = form.listId;
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
              <span className={styles.summaryValue}>{sourceValue || "—"}</span>
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
              <span className={styles.summaryValue}>{form.limit}</span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("scope")}>
                Edit
              </button>
            </div>
          )}
          {form.type === "ai_prompt" && (
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Min items</span>
              <span className={styles.summaryValue}>{form.minItems}</span>
              <button type="button" className={styles.summaryEdit} onClick={() => jumpTo("source")}>
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
    if (currentStep.id === "review") return renderReviewStep();
    return null;
  }

  return (
    <div
      className={`${styles.backdrop} ${exiting ? styles.backdropExiting : ""}`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div className={`${styles.modal} ${exiting ? styles.modalExiting : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerRow}>
            <h2 className={styles.title}>{mode === "edit" ? `Edit "${initial.name || "Rule"}"` : "Add Rule"}</h2>
            <button type="button" className={styles.closeBtn} onClick={handleClose} aria-label="Close">
              ✕
            </button>
          </div>
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
          {showError && stepError && currentStep?.id !== "review" && (
            <p className={styles.errorText} style={{ marginTop: 12 }}>
              {stepError}
            </p>
          )}
        </div>

        <div className={styles.footer}>
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
        </div>
      </div>
    </div>
  );
}

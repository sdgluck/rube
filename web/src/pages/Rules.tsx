import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import shared from "./Collections.module.css";
import styles from "./Rules.module.css";

const RULE_TYPES = [
  { value: "ai_prompt", label: "AI Prompt" },
  { value: "top_rated", label: "Top Rated" },
  { value: "lowest_rated", label: "Lowest Rated" },
  { value: "actors", label: "Actors" },
  { value: "studios", label: "Studios" },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(RULE_TYPES.map((t) => [t.value, t.label]));

interface FormState {
  id?: string;
  name: string;
  type: string;
  prompt: string;
  limit: number;
  minItems: number;
  sections: string[];
}

const EMPTY_FORM: FormState = {
  name: "",
  type: "ai_prompt",
  prompt: "",
  limit: 8,
  minItems: 15,
  sections: [],
};

function defaultLimitForType(type: string): number {
  if (type === "ai_prompt") return 8;
  if (type === "top_rated" || type === "lowest_rated") return 50;
  return 10;
}

function maxLimitForType(type: string): number {
  if (type === "ai_prompt") return 10;
  if (type === "top_rated" || type === "lowest_rated") return 200;
  return 50;
}

export default function Rules() {
  const utils = trpc.useUtils();
  const rulesQuery = trpc.rules.list.useQuery();
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const createMutation = trpc.rules.create.useMutation({ onSuccess: () => utils.rules.list.invalidate() });
  const updateMutation = trpc.rules.update.useMutation({ onSuccess: () => utils.rules.list.invalidate() });
  const deleteMutation = trpc.rules.delete.useMutation({ onSuccess: () => utils.rules.list.invalidate() });

  const [form, setForm] = useState<FormState | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const rules = rulesQuery.data || [];
  const sections = sectionsQuery.data || [];

  function startCreate() {
    setForm({ ...EMPTY_FORM });
    setIsEditing(false);
  }

  function startEdit(rule: (typeof rules)[0]) {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(rule.config || "{}");
    } catch {}
    setForm({
      id: rule.id,
      name: rule.name,
      type: rule.type,
      prompt: (config.prompt as string) || "",
      limit: (config.limit as number) ?? defaultLimitForType(rule.type),
      minItems: (config.minItems as number) ?? 15,
      sections: (config.sections as string[]) || [],
    });
    setIsEditing(true);
  }

  function cancelForm() {
    setForm(null);
    setIsEditing(false);
  }

  function handleSave() {
    if (!form) return;
    const config: Record<string, unknown> = { limit: form.limit };
    if (form.type === "ai_prompt") {
      config.prompt = form.prompt;
      config.minItems = form.minItems;
    }
    if (form.sections.length > 0) config.sections = form.sections;
    const configStr = JSON.stringify(config);

    if (isEditing && form.id) {
      updateMutation.mutate({ id: form.id, name: form.name, config: configStr }, { onSuccess: () => cancelForm() });
    } else {
      createMutation.mutate({ name: form.name, type: form.type, config: configStr }, { onSuccess: () => cancelForm() });
    }
  }

  function handleToggle(rule: (typeof rules)[0]) {
    updateMutation.mutate({ id: rule.id, enabled: !rule.enabled });
  }

  function handleDelete(rule: (typeof rules)[0]) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    deleteMutation.mutate({ id: rule.id });
  }

  // When switching type in create mode, reset limit to default
  useEffect(() => {
    if (form && !isEditing) {
      setForm((prev) => (prev ? { ...prev, limit: defaultLimitForType(prev.type) } : prev));
    }
  }, [form?.type]);

  if (rulesQuery.isLoading) return <p>Loading...</p>;

  return (
    <div>
      <div className={shared.header}>
        <h2 className={shared.heading}>Rules</h2>
        <button className={shared.button} onClick={startCreate} disabled={!!form}>
          Add Rule
        </button>
      </div>
      <p className={styles.description}>
        Rules define how the Generate Collections job creates collections. Each enabled rule runs during generation.
      </p>

      {rules.length === 0 && !form ? (
        <div className={shared.emptyState}>
          <p>No rules yet.</p>
          <p className={shared.hint}>Add a rule to start generating collections.</p>
        </div>
      ) : (
        <table className={shared.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Enabled</th>
              <th>Config</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              let configSummary = "";
              try {
                const c = JSON.parse(rule.config || "{}");
                if (rule.type === "ai_prompt") {
                  configSummary = `Limit: ${c.limit ?? 8} | Min items: ${c.minItems ?? 15}`;
                } else if (rule.type === "top_rated" || rule.type === "lowest_rated") {
                  configSummary = `${c.limit ?? 50} items`;
                } else {
                  configSummary = `Max: ${c.limit ?? 10}`;
                }
                if (c.sections?.length) configSummary += ` | Sections: ${c.sections.join(", ")}`;
              } catch {}

              const isAi = rule.type === "ai_prompt";
              return (
                <tr key={rule.id}>
                  <td>{rule.name}</td>
                  <td>
                    <span className={`${styles.typeLabel} ${isAi ? styles.typeAi : styles.typeCriteria}`}>
                      {TYPE_LABELS[rule.type] || rule.type}
                    </span>
                  </td>
                  <td className={styles.toggleCell}>
                    <input type="checkbox" checked={!!rule.enabled} onChange={() => handleToggle(rule)} />
                  </td>
                  <td>
                    <span className={styles.configSummary}>{configSummary}</span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={`${shared.button} ${shared.buttonSmall}`}
                        onClick={() => startEdit(rule)}
                        disabled={!!form}
                      >
                        Edit
                      </button>
                      <button
                        className={`${shared.buttonDanger} ${shared.buttonSmall}`}
                        onClick={() => handleDelete(rule)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {form && (
        <div className={styles.ruleForm}>
          <div className={styles.ruleFormField}>
            <label>Name</label>
            <input
              className={shared.input}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Rule name"
            />
          </div>

          <div className={styles.ruleFormField}>
            <label>Type</label>
            <select
              className={shared.select}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              disabled={isEditing}
            >
              {RULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {form.type === "ai_prompt" && (
            <>
              <div className={styles.ruleFormField}>
                <label>Prompt Template</label>
                <textarea
                  className={styles.promptTextarea}
                  value={form.prompt}
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                  placeholder="Enter your AI prompt template..."
                />
                <span className={styles.promptHint}>
                  Available placeholders: {"{sectionTitle}"}, {"{limit}"}, {"{minItems}"}
                </span>
              </div>
              <div className={styles.ruleFormField}>
                <label>Min items per collection</label>
                <input
                  type="number"
                  className={shared.input}
                  style={{ maxWidth: 120 }}
                  min={1}
                  max={100}
                  value={form.minItems}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      minItems: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)),
                    })
                  }
                />
                <span className={styles.promptHint}>Collections with fewer matched items will be skipped</span>
              </div>
            </>
          )}

          <div className={styles.ruleFormField}>
            <label>
              {form.type === "ai_prompt"
                ? "Collections per section"
                : form.type === "top_rated" || form.type === "lowest_rated"
                  ? "Items per collection"
                  : "Max collections"}
            </label>
            <input
              type="number"
              className={shared.input}
              style={{ maxWidth: 120 }}
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
            <span className={styles.promptHint}>Collections replace those generated in previous runs</span>
          </div>

          {sections.length > 0 && (
            <div className={styles.ruleFormField}>
              <label>Sections (optional override)</label>
              <div className={styles.configSections}>
                {sections.map((s) => (
                  <label key={s.key} className={styles.configSectionItem}>
                    <input
                      type="checkbox"
                      checked={form.sections.includes(s.title)}
                      onChange={() =>
                        setForm({
                          ...form,
                          sections: form.sections.includes(s.title)
                            ? form.sections.filter((t) => t !== s.title)
                            : [...form.sections, s.title],
                        })
                      }
                    />
                    <span>{s.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className={styles.formActions}>
            <button
              className={shared.button}
              onClick={handleSave}
              disabled={!form.name.trim() || createMutation.isPending || updateMutation.isPending}
            >
              {isEditing ? "Save" : "Create"}
            </button>
            <button className={shared.buttonSecondary} onClick={cancelForm}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

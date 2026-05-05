import shared from "#pages/Collections.module.css";
import styles from "#pages/Rules/RuleWizard/RuleWizard.module.css";
import { PRESET_THEMES, type SourceStepProps } from "#pages/Rules/RuleWizard/types.ts";
import { NAME_STYLES, VIBES } from "#pages/Rules/RuleWizard/constants.ts";

export default function AiPromptSource({ form, setForm }: SourceStepProps) {
  const toggleTheme = (t: string) => {
    const has = form.themes.includes(t);
    setForm({ ...form, themes: has ? form.themes.filter((x) => x !== t) : [...form.themes, t] });
  };
  const updateCustom = (i: number, v: string) => {
    const next = [...form.customThemes];
    next[i] = v;
    setForm({ ...form, customThemes: next });
  };
  const addCustom = () => setForm({ ...form, customThemes: [...form.customThemes, ""] });
  const removeCustom = (i: number) =>
    setForm({ ...form, customThemes: form.customThemes.filter((_, idx) => idx !== i) });

  return (
    <>
      <h3 className={styles.stepHeading}>Themes & style</h3>
      <p className={styles.stepSub}>
        Pick the angles the AI should explore. Past collections from this rule are automatically fed back in so it
        doesn't repeat itself.
      </p>

      <div className={styles.field}>
        <label>Themes</label>
        <div className={styles.pills}>
          {PRESET_THEMES.map((t) => {
            const selected = form.themes.includes(t);
            return (
              <button
                key={t}
                type="button"
                className={`${styles.pill} ${selected ? styles.pillSelected : ""}`}
                onClick={() => toggleTheme(t)}
                aria-pressed={selected}
              >
                {t}
              </button>
            );
          })}
        </div>
        <span className={styles.hint}>Pick one or more. The AI uses these as starting angles.</span>
      </div>

      <div className={styles.field}>
        <label>Custom themes (optional)</label>
        {form.customThemes.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input
              className={shared.input}
              value={t}
              onChange={(e) => updateCustom(i, e.target.value)}
              placeholder="e.g. Films set during a single night"
            />
            <button type="button" className={shared.buttonSecondary} onClick={() => removeCustom(i)}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className={shared.buttonSecondary} onClick={addCustom}>
          Add custom theme
        </button>
      </div>

      <div className={styles.field}>
        <label>Vibe</label>
        <div className={styles.pills}>
          {VIBES.map((v) => (
            <button
              key={v.value}
              type="button"
              className={`${styles.pill} ${form.vibe === v.value ? styles.pillSelected : ""}`}
              onClick={() => setForm({ ...form, vibe: v.value })}
              aria-pressed={form.vibe === v.value}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label>Name style</label>
        <div className={styles.pills}>
          {NAME_STYLES.map((n) => (
            <button
              key={n.value}
              type="button"
              className={`${styles.pill} ${form.nameStyle === n.value ? styles.pillSelected : ""}`}
              onClick={() => setForm({ ...form, nameStyle: n.value })}
              aria-pressed={form.nameStyle === n.value}
            >
              {n.label}
            </button>
          ))}
        </div>
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

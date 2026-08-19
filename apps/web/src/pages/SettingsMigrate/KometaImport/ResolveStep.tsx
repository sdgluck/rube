import styles from "#pages/Settings/Settings.module.css";
import local from "../SettingsMigrate.module.css";

export interface ImportSummary {
  importId: string;
  libraries: Array<{ name: string; suggestedSectionId: string | null; suggestedSectionTitle: string | null }>;
  resolutions: Array<{
    kind: string;
    value: string;
    status: "resolved" | "default" | "missing";
    reason: string | null;
    fileCount: number;
  }>;
  definitionCount: number;
  diagnostics: Array<{ severity: "error" | "warn" | "info"; file?: string; line?: number; message: string }>;
}

interface ResolveStepProps {
  summary: ImportSummary;
  sections: Array<{ key: string; title: string }>;
  sectionMap: Record<string, string>;
  onSectionChange: (library: string, sectionId: string) => void;
}

/**
 * What was found, before anything is mapped.
 *
 * Separating this from the review screen is deliberate. "Which of my files did
 * you actually read?" and "what will each collection become?" are different
 * questions, and answering them on one screen buries the first — which is the
 * one that catches the expensive mistake, where half a config silently wasn't
 * there and the user only notices after migrating.
 */
export default function ResolveStep({ summary, sections, sectionMap, onSectionChange }: ResolveStepProps) {
  const missing = summary.resolutions.filter((r) => r.status === "missing");
  const errors = summary.diagnostics.filter((d) => d.severity === "error");
  const warnings = summary.diagnostics.filter((d) => d.severity === "warn");
  const unmapped = summary.libraries.filter((l) => !sectionMap[l.name]);

  // Kometa's built-in defaults produce rules without ever being a "definition"
  // — there's no file to read them from. Counting only definitions tells a
  // defaults-only user, whose entire config is `default:` entries, that we
  // found nothing, one screen before we propose seven rules.
  const defaultCount = summary.resolutions.filter((r) => r.status === "default").length;
  const found: string[] = [];
  if (summary.definitionCount > 0) {
    found.push(`${summary.definitionCount} collection definition${summary.definitionCount === 1 ? "" : "s"}`);
  }
  if (defaultCount > 0) found.push(`${defaultCount} built-in Kometa default${defaultCount === 1 ? "" : "s"}`);

  return (
    <div className={styles.form}>
      <p className={styles.hint}>
        {found.length > 0 ? (
          <>
            Found <strong>{found.join(" and ")}</strong> across {summary.libraries.length} librar
            {summary.libraries.length === 1 ? "y" : "ies"}.
          </>
        ) : (
          <>Nothing to migrate was found in that config.</>
        )}
      </p>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Which Plex library is which?</h3>
        <p className={styles.hint}>
          Kometa names libraries by their Plex title, so these are usually right — but a renamed library would send its
          collections to the wrong place, so it's worth a look.
        </p>
        {summary.libraries.map((lib) => (
          <div className={styles.field} key={lib.name}>
            <label htmlFor={`lib-${lib.name}`}>{lib.name}</label>
            <select
              id={`lib-${lib.name}`}
              className={local.input}
              value={sectionMap[lib.name] ?? ""}
              onChange={(e) => onSectionChange(lib.name, e.target.value)}
            >
              <option value="">Don't migrate this library</option>
              {sections.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        ))}
        {unmapped.length > 0 && (
          <p className={`${styles.hint} ${local.warnHint}`}>
            {unmapped.length} librar{unmapped.length === 1 ? "y has" : "ies have"} no Plex library chosen — their
            collections won't be migrated.
          </p>
        )}
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Files</h3>
        <ul className={local.bulletsScroll}>
          {summary.resolutions.map((r, i) => (
            <li key={`${r.kind}-${r.value}-${i}`}>
              <span className={local.fileStatus} data-status={r.status}>
                {r.status === "resolved" ? "✓" : r.status === "default" ? "•" : "✗"}
              </span>{" "}
              <code>
                {r.kind}: {r.value}
              </code>{" "}
              {r.status === "resolved" && (
                <span className={local.muted}>
                  ({r.fileCount} file{r.fileCount === 1 ? "" : "s"})
                </span>
              )}
              {r.status === "default" && <span className={local.muted}>(built-in Kometa default)</span>}
              {r.status === "missing" && <span className={local.muted}>— {r.reason}</span>}
            </li>
          ))}
        </ul>
        {missing.length > 0 && (
          <p className={`${styles.hint} ${local.warnHint}`}>
            {missing.length} file{missing.length === 1 ? "" : "s"} couldn't be read. Any collections defined in
            {missing.length === 1 ? " it" : " them"} won't be migrated — go back and include{" "}
            {missing.length === 1 ? "it" : "them"} if you want{" "}
            {missing.length === 1 ? "that collection" : "those collections"} too.
          </p>
        )}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>Notes</h3>
          <ul className={local.bulletsScroll}>
            {[...errors, ...warnings].map((d, i) => (
              <li key={i}>
                <span className={local.fileStatus} data-status={d.severity === "error" ? "missing" : "warn"}>
                  {d.severity === "error" ? "✗" : "!"}
                </span>{" "}
                {d.file && (
                  <code>
                    {d.file}
                    {d.line ? `:${d.line}` : ""}
                  </code>
                )}{" "}
                {d.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import styles from "#pages/Settings/Settings.module.css";
import local from "../SettingsMigrate.module.css";

type Confidence = "exact" | "close" | "partial";

interface PlanItem {
  key: string;
  ruleType: string;
  ruleName: string;
  sectionTitle: string;
  confidence: Confidence;
  warnings: Array<{ code: string; message: string }>;
  origin: { file?: string; line?: number; definition?: string; builders?: string[] };
  replacesCount: number;
}

interface UnmappableEntry {
  title: string;
  sectionTitle: string;
  reason: string;
  builders?: string[];
  file?: string;
  line?: number;
}

interface ReviewStepProps {
  proposed: PlanItem[];
  unmappable: UnmappableEntry[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleMany: (keys: string[], on: boolean) => void;
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  exact: "Exact",
  close: "Close",
  partial: "Partial",
};

const CONFIDENCE_HINT: Record<Confidence, string> = {
  exact: "Everything Kometa specified came across.",
  close: "Something cosmetic was lost — the same items will be in it.",
  partial: "This rule will select a different set of items than Kometa did.",
};

/**
 * The fidelity screen: one row per Kometa definition, saying what it becomes
 * and what it costs.
 *
 * The confidence chip is the whole point of this screen. A migration that
 * reports "142 rules created" and stops is asking to be trusted; one that says
 * "96 exact, 14 close, 8 partial, and here's precisely which filter got
 * dropped from which collection" can actually be checked. Grouping by source
 * file matters for the same reason — people recognise their own config, not an
 * alphabetical list of rule names.
 */
export default function ReviewStep({ proposed, unmappable, selected, onToggle, onToggleMany }: ReviewStepProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNotMigrated, setShowNotMigrated] = useState(false);

  const counts = {
    exact: proposed.filter((p) => p.confidence === "exact").length,
    close: proposed.filter((p) => p.confidence === "close").length,
    partial: proposed.filter((p) => p.confidence === "partial").length,
  };

  // Group by the file each definition came from — a `default:` entry has no
  // file, so those collect under one heading of their own.
  const groups = new Map<string, PlanItem[]>();
  for (const item of proposed) {
    const key = item.origin.file ?? "Kometa defaults";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const report = [
    `# Not migrated from Kometa (${unmappable.length})`,
    "",
    ...unmappable.map(
      (u) =>
        `- **${u.title}**${u.sectionTitle ? ` (${u.sectionTitle})` : ""} — ${u.reason}` +
        (u.builders?.length ? ` [${u.builders.join(", ")}]` : "") +
        (u.file ? ` — ${u.file}${u.line ? `:${u.line}` : ""}` : ""),
    ),
  ].join("\n");

  return (
    <div className={styles.form}>
      <p className={styles.hint}>
        <strong>{proposed.length}</strong> definition{proposed.length === 1 ? "" : "s"} map to rules
        {proposed.length > 0 && (
          <>
            {" — "}
            {counts.exact} exact, {counts.close} close, {counts.partial} partial
          </>
        )}
        {unmappable.length > 0 && <>. {unmappable.length} couldn't be migrated.</>}
      </p>

      {counts.partial > 0 && (
        <p className={`${styles.hint} ${local.warnHint}`}>
          The {counts.partial} “partial” rule{counts.partial === 1 ? "" : "s"} will hold a different set of items than
          Kometa's did. They're created switched off so you can check them first.
        </p>
      )}

      {[...groups.entries()].map(([file, items]) => {
        const keys = items.map((i) => i.key);
        const allOn = keys.every((k) => selected.has(k));
        return (
          <div className={styles.group} key={file}>
            <h3 className={styles.groupTitle}>
              <code>{file}</code>{" "}
              <button type="button" className={local.linkButton} onClick={() => onToggleMany(keys, !allOn)}>
                {allOn ? "none" : "all"}
              </button>
            </h3>
            <div className="table-scroll in-panel">
              <table className={local.planTable}>
                <thead>
                  <tr>
                    <th className={local.checkCol}>
                      <span className="sr-only">Include</span>
                    </th>
                    <th>Collection</th>
                    <th>Becomes</th>
                    <th>Library</th>
                    <th>Fidelity</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.key}>
                      <td data-cell="meta">
                        <input type="checkbox" checked={selected.has(p.key)} onChange={() => onToggle(p.key)} />
                      </td>
                      <td data-cell="title">
                        <div>{p.ruleName}</div>
                        <div className={local.rowHint}>
                          {p.origin.builders?.length ? p.origin.builders.join(", ") : p.origin.definition}
                          {p.origin.line ? ` · line ${p.origin.line}` : ""}
                        </div>
                      </td>
                      <td data-cell="meta">
                        <code>{p.ruleType}</code>
                      </td>
                      <td data-cell="meta">{p.sectionTitle}</td>
                      <td data-cell="meta">
                        <span className={local.confidenceChip} data-confidence={p.confidence}>
                          {CONFIDENCE_LABEL[p.confidence]}
                        </span>
                        {p.warnings.length > 0 ? (
                          <button type="button" className={local.linkButton} onClick={() => toggleExpanded(p.key)}>
                            {expanded.has(p.key)
                              ? "hide"
                              : `${p.warnings.length} note${p.warnings.length === 1 ? "" : "s"}`}
                          </button>
                        ) : (
                          <div className={local.rowHint}>{CONFIDENCE_HINT[p.confidence]}</div>
                        )}
                        {expanded.has(p.key) && (
                          <ul className={local.warningList}>
                            {p.warnings.map((w, i) => (
                              <li key={i}>{w.message}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {unmappable.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>
            Not migrated ({unmappable.length}){" "}
            <button type="button" className={local.linkButton} onClick={() => setShowNotMigrated((v) => !v)}>
              {showNotMigrated ? "hide" : "show"}
            </button>
          </h3>
          <p className={styles.hint}>
            These collections stay exactly as they are in Plex — nothing is deleted. But Tinkerbell won't be updating
            them, so they'll go stale once you stop running Kometa.
          </p>
          {showNotMigrated && (
            <>
              <ul className={local.bulletsScroll}>
                {unmappable.map((u, i) => (
                  <li key={i}>
                    <strong>{u.title}</strong> <span className={local.muted}>— {u.reason}</span>
                  </li>
                ))}
              </ul>
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => void navigator.clipboard?.writeText(report)}
                >
                  Copy list
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

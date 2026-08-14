import { useMemo, useState } from "react";
import type { RegistryIndex } from "@tinkerbell/contracts";
import Modal from "#components/Modal";
import ImportModal from "./ImportModal";
import { REQUIREMENT_LABELS } from "./labels";
import styles from "./Registry.module.css";

interface PackDetailProps {
  packSlug: string;
  index: RegistryIndex;
  onClose: () => void;
}

/**
 * Pack contents with per-rule checkboxes. Cherry-picking matters here: a pack
 * is a curated grouping, not a transaction, and half of "Prestige TV" is
 * useless on a movie library.
 */
export default function PackDetail({ packSlug, index, onClose }: PackDetailProps) {
  const pack = index.packs.find((p) => p.slug === packSlug)!;
  const rules = useMemo(() => {
    const bySlug = new Map(index.rules.map((r) => [r.slug, r]));
    return pack.ruleSlugs.flatMap((s) => {
      const rule = bySlug.get(s);
      return rule ? [rule] : [];
    });
  }, [index, pack]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(rules.map((r) => r.slug)));
  const [importing, setImporting] = useState(false);

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const selectedRules = rules.filter((r) => selected.has(r.slug));

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={pack.title}
        meta={`${rules.length} rule${rules.length === 1 ? "" : "s"}`}
        size="lg"
        footer={
          <div className={styles.footer}>
            <span className={styles.footerCount}>
              {selectedRules.length} of {rules.length} selected
            </span>
            <div className={styles.footerActions}>
              <button type="button" className={styles.ghost} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={selectedRules.length === 0}
                onClick={() => setImporting(true)}
              >
                Import…
              </button>
            </div>
          </div>
        }
      >
        <p className={styles.packBody}>{pack.description}</p>

        <ul className={styles.ruleList}>
          {rules.map((rule) => (
            <li key={rule.slug}>
              <label className={styles.ruleRow}>
                <input type="checkbox" checked={selected.has(rule.slug)} onChange={() => toggle(rule.slug)} />
                <span className={styles.ruleText}>
                  <span className={styles.ruleName}>{rule.name}</span>
                  <span className={styles.ruleDesc}>{rule.description}</span>
                  <span className={styles.ruleChips}>
                    <span className={styles.type}>{rule.type}</span>
                    {rule.mediaTypes.length === 1 && (
                      <span className={styles.chip}>{rule.mediaTypes[0] === "movie" ? "Movies only" : "TV only"}</span>
                    )}
                    {rule.requires.map((req) => (
                      <span key={req} className={styles.chip}>
                        needs {REQUIREMENT_LABELS[req] ?? req}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>

      {importing && (
        <ImportModal
          packSlug={pack.slug}
          packTitle={pack.title}
          ruleSlugs={selectedRules.map((r) => r.slug)}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

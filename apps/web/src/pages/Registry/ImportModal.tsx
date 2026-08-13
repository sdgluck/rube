import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import Modal from "#components/Modal";
import ToggleSwitch from "#components/ToggleSwitch";
import Spinner from "#components/Spinner";
import { useToast } from "#components/Toast";
import { REQUIREMENT_LABELS, REQUIREMENT_SETTINGS } from "./labels";
import styles from "./Registry.module.css";

interface ImportModalProps {
  packSlug: string;
  packTitle: string;
  ruleSlugs: string[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * Library picker plus the dry-run preview.
 *
 * The preview is the point: registry content is remote, and everything that
 * could quietly disappoint someone after import — a genre clause this server
 * has no tag for, an integration that isn't set up, a name that already
 * exists — is surfaced here while it's still cancellable.
 */
export default function ImportModal({ packSlug, packTitle, ruleSlugs, onClose, onDone }: ImportModalProps) {
  const { addToast } = useToast();
  const utils = trpc.useUtils();
  const [sectionTitles, setSectionTitles] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);

  const sectionsQuery = trpc.plexSections.useQuery(undefined, { staleTime: 5 * 60_000 });

  const previewQuery = trpc.registry.previewImport.useQuery(
    { packSlug, ruleSlugs, sectionTitles },
    { enabled: sectionTitles.length > 0, retry: false },
  );

  const importMutation = trpc.registry.import.useMutation({
    onSuccess: (result) => {
      utils.rules.list.invalidate();
      utils.registry.updates.invalidate();
      utils.nav.metrics.invalidate();
      addToast(
        `Imported ${result.created.length} rule${result.created.length === 1 ? "" : "s"}${
          enabled ? "" : " (disabled)"
        }`,
        "success",
      );
      onDone();
    },
    onError: (err) => addToast(err.message || "Import failed", "error"),
  });

  const toggleSection = (title: string) => {
    setSectionTitles((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]));
  };

  const plan = previewQuery.data;
  const warnings = plan?.items.flatMap((i) => i.resolutionWarnings) ?? [];
  const missing = [...new Set(plan?.items.flatMap((i) => i.missingRequirements) ?? [])];
  const collisions = plan?.items.filter((i) => i.nameCollision) ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Import ${packTitle}`}
      meta={`${ruleSlugs.length} rule${ruleSlugs.length === 1 ? "" : "s"}`}
      size="lg"
      footer={
        <div className={styles.footer}>
          <label className={styles.enableRow}>
            <ToggleSwitch checked={enabled} onChange={setEnabled} size="sm" />
            <span>
              Enable after import
              <span className={styles.enableHint}>
                {enabled ? "Rules will run on their next schedule." : "Review them on the Rules page first."}
              </span>
            </span>
          </label>
          <div className={styles.footerActions}>
            <button type="button" className={styles.ghost} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={sectionTitles.length === 0 || previewQuery.isFetching || importMutation.isPending}
              onClick={() => importMutation.mutate({ packSlug, ruleSlugs, sectionTitles, enabled })}
            >
              {importMutation.isPending ? <Spinner size="xs" /> : null}
              Import {plan ? `${plan.items.length} rule${plan.items.length === 1 ? "" : "s"}` : "rules"}
            </button>
          </div>
        </div>
      }
    >
      <section className={styles.step}>
        <h3>Libraries</h3>
        <p className={styles.stepHint}>
          Each imported rule is scoped to the libraries you pick. Filters are matched against these libraries' Plex
          tags.
        </p>
        <div className={styles.sections}>
          {(sectionsQuery.data ?? []).map((section) => (
            <label key={section.key} className={styles.sectionChip} data-on={sectionTitles.includes(section.title)}>
              <input
                type="checkbox"
                checked={sectionTitles.includes(section.title)}
                onChange={() => toggleSection(section.title)}
              />
              {section.title}
              <span className={styles.sectionType}>{section.type}</span>
            </label>
          ))}
        </div>
        {sectionsQuery.data?.length === 0 && (
          <p className={styles.warn}>No Plex libraries found. Check Settings → Plex, then refresh libraries.</p>
        )}
      </section>

      {sectionTitles.length > 0 && (
        <section className={styles.step}>
          <h3>Preview</h3>

          {previewQuery.isFetching && (
            <p className={styles.stepHint}>
              <Spinner size="xs" /> Checking this pack against your libraries…
            </p>
          )}

          {previewQuery.error && <p className={styles.warn}>{previewQuery.error.message}</p>}

          {plan && !previewQuery.isFetching && (
            <>
              {missing.length > 0 && (
                <div className={styles.notice} data-tone="warn">
                  <strong>Not configured yet:</strong>{" "}
                  {missing.map((req, i) => (
                    <span key={req}>
                      {i > 0 && ", "}
                      <Link to={REQUIREMENT_SETTINGS[req] ?? "/settings"}>{REQUIREMENT_LABELS[req] ?? req}</Link>
                    </span>
                  ))}
                  . Those rules will import but won't produce anything until you set this up.
                </div>
              )}

              {warnings.length > 0 && (
                <div className={styles.notice} data-tone="warn">
                  <strong>
                    {warnings.length} filter value{warnings.length === 1 ? "" : "s"} not found on this server:
                  </strong>
                  <ul className={styles.warnList}>
                    {warnings.map((w, i) => (
                      <li key={i}>
                        <code>
                          {w.field} = {w.value}
                        </code>{" "}
                        in {w.sectionTitle}
                      </li>
                    ))}
                  </ul>
                  Those clauses won't match anything. Edit the rule after import, or pick a different library.
                </div>
              )}

              {collisions.length > 0 && (
                <div className={styles.notice} data-tone="info">
                  <strong>{collisions.length} name already in use.</strong> Imported as{" "}
                  {collisions.map((c) => `"${c.name}"`).join(", ")} so your existing rules aren't touched.
                </div>
              )}

              {missing.length === 0 && warnings.length === 0 && collisions.length === 0 && (
                <div className={styles.notice} data-tone="ok">
                  All {plan.items.length} rule{plan.items.length === 1 ? "" : "s"} resolved cleanly against{" "}
                  {plan.sectionTitles.join(", ")}.
                </div>
              )}

              <ul className={styles.planList}>
                {plan.items.map((item) => (
                  <li key={item.rule.slug}>
                    <span className={styles.ruleName}>{item.name}</span>
                    <span className={styles.type}>{item.rule.type}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </Modal>
  );
}

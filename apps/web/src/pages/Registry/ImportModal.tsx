import { useState } from "react";
import { Link } from "react-router-dom";
import { fieldLabel, producesManyCollections } from "@tinkerbell/contracts";
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

  // Pack defaults, editable before anything is written: grouped rules build a
  // collection per director/genre/… and rotate ten onto the homepage.
  const [pin, setPin] = useState(true);
  const [rotation, setRotation] = useState(10);
  const [limit, setLimit] = useState(0);
  const [minItems, setMinItems] = useState(0);

  const sectionsQuery = trpc.plexSections.useQuery(undefined, { staleTime: 5 * 60_000 });
  const indexQuery = trpc.registry.index.useQuery({ force: false }, { staleTime: 60 * 60_000 });

  // Only worth asking about when the pack actually contains a rule whose
  // collection count scales with the library.
  const hasGroupedRules = (indexQuery.data?.rules ?? []).some(
    (r) => ruleSlugs.includes(r.slug) && producesManyCollections(r.type),
  );

  const overrides = {
    ...(pin ? { pinToHomepage: true, pinRotationCount: rotation } : { pinToHomepage: false as const }),
    ...(limit > 0 ? { limit } : {}),
    ...(minItems > 0 ? { minItems } : {}),
  };

  const previewQuery = trpc.registry.previewImport.useQuery(
    { packSlug, ruleSlugs, sectionTitles, overrides },
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
              onClick={() => importMutation.mutate({ packSlug, ruleSlugs, sectionTitles, enabled, overrides })}
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

      {hasGroupedRules && (
        <section className={styles.step}>
          <h3>Collections & homepage</h3>
          <p className={styles.stepHint}>
            Applies to the rules in this pack that build one collection per director, genre, decade, and so on. The
            pack's other rules keep their own settings.
          </p>

          <label className={styles.optionRow}>
            <ToggleSwitch checked={pin} onChange={setPin} size="sm" />
            <span>
              Pin to the homepage
              <span className={styles.enableHint}>
                {pin
                  ? "A different set is pinned on each run, so one rule can't take over the home screen."
                  : "Collections are still created in Plex, but your home screen is left alone."}
              </span>
            </span>
          </label>

          {pin && (
            <label className={styles.optionRow}>
              <input
                type="number"
                className={styles.numberInput}
                min={1}
                value={rotation}
                onChange={(e) => setRotation(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
              <span>
                On the homepage at a time
                <span className={styles.enableHint}>Per library, per rule.</span>
              </span>
            </label>
          )}

          <label className={styles.optionRow}>
            <input
              type="number"
              className={styles.numberInput}
              min={0}
              value={limit || ""}
              placeholder="All"
              onChange={(e) => setLimit(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
            <span>
              Most collections per rule
              <span className={styles.enableHint}>
                {limit > 0
                  ? `Keeps the ${limit} biggest and skips the rest.`
                  : "Blank builds one for every group in the library — the pack's default."}
              </span>
            </span>
          </label>

          <label className={styles.optionRow}>
            <input
              type="number"
              className={styles.numberInput}
              min={0}
              value={minItems || ""}
              placeholder="Any"
              onChange={(e) => setMinItems(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
            <span>
              Fewest items per collection
              <span className={styles.enableHint}>
                {minItems > 0
                  ? `Skips groups with fewer than ${minItems} items.`
                  : "Blank keeps groups of any size, including one-item ones."}
              </span>
            </span>
          </label>
        </section>
      )}

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
                        {fieldLabel(w.field)} <strong>{w.value}</strong> in {w.sectionTitle}
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

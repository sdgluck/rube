import { useState } from "react";
import { Link } from "react-router-dom";
import { isSeededRule } from "@rube/contracts";
import { trpc } from "#/trpc";
import PackDetail from "#pages/Registry/PackDetail";
import { REQUIREMENT_LABELS } from "#pages/Registry/labels";
import Spinner from "#components/Spinner";
import controls from "#/styles/controls.module.css";
import styles from "./Onboarding.module.css";

/**
 * The pack we point a new admin at when they have no reason to prefer another
 * — the registry nominates this one for the job itself ("start here if you're
 * not sure which pack to try").
 *
 * It isn't requirement-free: `picked-for-you` is an `ai_prompt` rule and needs
 * an LLM. That's survivable because `PackDetail` is per-rule checkboxes rather
 * than all-or-nothing, and `ImportModal` names any unmet requirement in its
 * preview before writing anything — so the four rules that do work still
 * import cleanly on a bare install.
 */
const RECOMMENDED_PACK = "netflix-style";

export default function RulesStep() {
  const [openPack, setOpenPack] = useState<string | null>(null);
  const registryQuery = trpc.registry.index.useQuery({ force: false }, { staleTime: 10 * 60_000 });
  const rulesQuery = trpc.rules.list.useQuery();
  const utils = trpc.useUtils();

  const index = registryQuery.data;
  // The same exclusion the server's `rules` step derivation makes — otherwise
  // this line reads "you have 1 rule" beside an unticked step.
  const rules = (rulesQuery.data ?? []).filter((r) => !isSeededRule(r));

  return (
    <div className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Add your first rules</h2>
      {rules.length > 0 && (
        <p className={styles.notice}>
          You have {rules.length} rule{rules.length === 1 ? "" : "s"}
          {rules.some((r) => r.enabled) ? "" : ", none enabled yet"}.
        </p>
      )}

      <h3 className={styles.groupHeading}>Import a pack</h3>
      {registryQuery.isLoading ? (
        <Spinner />
      ) : registryQuery.error || !index ? (
        <p className={styles.fieldHint}>
          Couldn't reach the rule registry — try <Link to="/registry">Registry</Link> later.
        </p>
      ) : (
        <div className={styles.tileGrid}>
          {index.packs.map((pack) => {
            const bySlug = new Map(index.rules.map((r) => [r.slug, r]));
            const packRules = pack.ruleSlugs.flatMap((s) => {
              const rule = bySlug.get(s);
              return rule ? [rule] : [];
            });
            const requirements = [...new Set(packRules.flatMap((r) => r.requires))].sort();
            const recommended = pack.slug === RECOMMENDED_PACK;
            return (
              <button
                key={pack.slug}
                type="button"
                className={`${styles.tile} ${styles.tileClickable} ${recommended ? styles.tilePrimary : ""}`}
                onClick={() => setOpenPack(pack.slug)}
              >
                <span className={styles.tileHeadStatic}>
                  <span className={styles.tileTitle}>{pack.title}</span>
                  {recommended && <span className={styles.tileState}>Recommended</span>}
                </span>
                <span className={styles.tileBlurb}>{pack.tagline}</span>
                <span className={styles.tileMeta}>
                  <span>
                    {packRules.length} rule{packRules.length === 1 ? "" : "s"}
                  </span>
                  {requirements.map((req) => (
                    <span key={req} className={styles.req}>
                      needs {REQUIREMENT_LABELS[req] ?? req}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <h3 className={styles.groupHeading}>Or write your own</h3>
      <Link to="/rules" className={`${styles.inlineAction} ${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}>
        Open the rule builder
      </Link>

      {openPack && index && (
        <PackDetail
          packSlug={openPack}
          index={index}
          onClose={() => {
            setOpenPack(null);
            // The import writes rules, which is what this step is derived from.
            utils.rules.list.invalidate();
            utils.onboarding.status.invalidate();
          }}
        />
      )}
    </div>
  );
}

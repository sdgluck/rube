import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@tinkerbell/trpc";
import styles from "./Rules.module.css";

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type FunnelSection = NonNullable<NonNullable<RouterOutputs["rules"]["lastTestResult"]>["funnel"]>[number];

/**
 * Where the items went, clause by clause.
 *
 * The number this exists for is zero. "0 items" with six clauses in the rule
 * makes all six equally suspect; the clause whose row drops to nothing is the
 * answer, and it's usually obvious the moment you can see the sequence.
 *
 * The bar is proportional to the library, not to the previous step, so a clause
 * that halves the set looks like half — a bar rescaled at each step makes every
 * clause look equally decisive.
 */
export default function FilterFunnel({ sections }: { sections: FunnelSection[] }) {
  return (
    <div className={styles.funnel}>
      {sections.map((section) => (
        <div key={section.sectionTitle} className={styles.funnelSection}>
          <div className={styles.funnelHead}>
            <strong>{section.sectionTitle}</strong>
            <span className={styles.funnelHeadMeta}>
              {section.mode === "contributing"
                ? "any of these clauses — each measured against the whole library"
                : `${section.start.toLocaleString()} → ${section.final.toLocaleString()}`}
            </span>
          </div>
          <ol className={styles.funnelSteps}>
            <li className={styles.funnelStep}>
              <span className={styles.funnelLabel}>Everything in the library</span>
              <FunnelBar value={section.start} of={section.start} />
              <span className={styles.funnelCount}>{section.start.toLocaleString()}</span>
            </li>
            {section.steps.map((step, i) => (
              <li key={i} className={styles.funnelStep}>
                <span className={styles.funnelLabel}>
                  {step.label}
                  {/* Watch-state clauses are applied here, not by Plex — worth
                      saying, because they're the ones that behave differently. */}
                  {step.source === "local" && <span className={styles.funnelLocalTag}>watch history</span>}
                </span>
                <FunnelBar value={step.remaining} of={section.start} />
                <span className={styles.funnelCount}>
                  {step.remaining.toLocaleString()}
                  {step.removed > 0 && <span className={styles.funnelRemoved}>−{step.removed.toLocaleString()}</span>}
                </span>
              </li>
            ))}
          </ol>
          {section.final === 0 && section.steps.length > 0 && (
            <p className={styles.funnelVerdict}>
              {(() => {
                const culprit = section.steps.find((s) => s.remaining === 0);
                return culprit
                  ? `Nothing survives "${culprit.label}". Loosen that clause first.`
                  : "Nothing matched, though no single clause emptied it — the combination is too narrow.";
              })()}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function FunnelBar({ value, of }: { value: number; of: number }) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <span className={styles.funnelTrack} aria-hidden="true">
      {/* A surviving-but-tiny result still gets a sliver, so "a few" and
          "none" don't render identically. */}
      <span className={styles.funnelFill} style={{ width: `${value > 0 ? Math.max(pct, 1) : 0}%` }} />
    </span>
  );
}

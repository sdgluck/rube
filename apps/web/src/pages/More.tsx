import { NavLink } from "react-router-dom";
import PageShell from "#components/PageShell";
import { MORE_SECTIONS, type NavItem } from "#/nav";
import { trpc } from "#/trpc";
import styles from "./More.module.css";

type NavMetrics = Record<string, number | "ok" | "error" | null>;
type MetaTone = "ok" | "error";

const TONE_DOT: Record<MetaTone, string> = {
  ok: styles.dotOk,
  error: styles.dotError,
};

/** The row's trailing value: what this page currently holds, in mono. */
function navMeta(item: NavItem, metrics: NavMetrics | undefined): { tone?: MetaTone; text: string } {
  if (!item.metric || !metrics) return { text: "" };
  if (item.metric.kind === "streams") return { text: "" };
  const value = metrics[item.metric.key];
  if (item.metric.kind === "status") {
    if (value === "ok") return { tone: "ok", text: "ok" };
    if (value === "error") return { tone: "error", text: "failed" };
    return { text: "never run" };
  }
  if (typeof value !== "number" || value === 0) return { text: "—" };
  if (item.metric.key === "eventsErrors24h") {
    return { tone: "error", text: `${value} error${value === 1 ? "" : "s"} 24h` };
  }
  return { text: value.toLocaleString() };
}

/**
 * The mobile "More" tab: everything the sidebar holds that isn't one of the
 * three bottom tabs. A real route rather than a sheet, so back, scroll
 * restoration and deep links work on it the way they do on every other page,
 * and the list isn't capped to a fraction of the viewport.
 */
export default function More() {
  const metricsQuery = trpc.nav.metrics.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const metrics = metricsQuery.data as NavMetrics | undefined;

  return (
    <PageShell>
      <nav aria-label="More pages" className={styles.sections}>
        {MORE_SECTIONS.map((section) => (
          <section key={section.label}>
            <h2 className={styles.sectionTitle}>{section.label}</h2>
            <div className={styles.list}>
              {section.items.map((item) => {
                const meta = navMeta(item, metrics);
                return (
                  <NavLink key={item.to} to={item.to} className={styles.row}>
                    <span className={styles.label}>{item.label}</span>
                    {meta.text && (
                      <span className={styles.meta}>
                        {meta.tone && <span className={`${styles.dot} ${TONE_DOT[meta.tone]}`} />}
                        {meta.text}
                      </span>
                    )}
                    <svg
                      className={styles.chevron}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </NavLink>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </PageShell>
  );
}

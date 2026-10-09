import { Activity, Loader, Search, Sparkles } from "lucide-react";
import PageShell from "#components/PageShell";
import ListRow, { RowIcon } from "#components/list/ListRow";
import ListSection from "#components/list/ListSection";
import { type NavItem } from "#/nav";
import { useNavMenu } from "#hooks/useNavMenu";
import NavEditor from "#layout/NavEditor";
import { navIcon } from "#layout/navIcons";
import { openSearch } from "#lib/openSearch";
import { trpc } from "#/trpc";
import styles from "./More.module.css";

type NavMetrics = Record<string, number | "ok" | "error" | null>;

/** The row's trailing value: what this page currently holds. */
function navMeta(item: NavItem, metrics: NavMetrics | undefined): string {
  if (!item.metric || !metrics) return "";
  if (item.metric.kind === "streams") return "";
  const value = metrics[item.metric.key];
  if (item.metric.kind === "status") {
    if (value === "ok") return "OK";
    if (value === "error") return "Failed";
    return "";
  }
  if (typeof value !== "number" || value === 0) return "";
  if (item.metric.key === "eventsErrors24h") return `${value} error${value === 1 ? "" : "s"}`;
  return value.toLocaleString();
}

/**
 * The mobile "More" tab: everything the sidebar holds that isn't one of the
 * bottom tabs. A real route rather than a sheet, so back, scroll restoration
 * and deep links work on it the way they do on every other page, and the list
 * isn't capped to a fraction of the viewport.
 *
 * Laid out as a native grouped list (the iOS Settings app, a Material
 * settings screen): search first, then what the sidebar shows besides links —
 * setup progress, running jobs, server health — which a phone otherwise had
 * no way to see, then every destination with its icon.
 */
export default function More() {
  const metricsQuery = trpc.nav.metrics.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const metrics = metricsQuery.data as NavMetrics | undefined;
  const menu = useNavMenu();
  const onboarding = trpc.onboarding.status.useQuery(undefined, { retry: false }).data;
  const health = trpc.health.status.useQuery(undefined, { refetchInterval: 30000, refetchOnWindowFocus: false }).data;
  const activeRuns = trpc.jobs.activeRuns.useQuery(undefined, { refetchInterval: 5000 }).data;

  /**
   * The sidebar can't be where a phone edits its menu — it isn't rendered below
   * the breakpoint. This page is the mobile sidebar, so it carries the same
   * editor, and the tab bar being arranged is on screen underneath it, updating
   * as you go. Reordering here is buttons only: mobile Safari doesn't implement
   * HTML5 drag-and-drop, so a drag handle would be a control that does nothing.
   */
  if (menu.editing) {
    return (
      <PageShell>
        <div className={styles.editing}>
          <NavEditor menu={menu} />
        </div>
      </PageShell>
    );
  }

  const checked = (health ?? []).filter((s) => s.configured && s.status !== null);
  const failing = checked.filter((s) => s.status === "error").length;
  const running = activeRuns?.length ?? 0;
  const setupLeft = onboarding && !onboarding.complete ? onboarding.totalCount - onboarding.completedCount : 0;

  return (
    <PageShell
      actions={
        <button type="button" className={styles.editButton} onClick={() => menu.setEditing(true)}>
          Edit menu
        </button>
      }
    >
      <div className={styles.sections}>
        {/* Looks like the platform's search field; opens the real one. */}
        <button type="button" className={styles.searchField} onClick={openSearch}>
          <Search size="1.7rem" strokeWidth={2} aria-hidden />
          Search
        </button>

        {(setupLeft > 0 || running > 0 || checked.length > 0) && (
          <ListSection title="Server">
            {setupLeft > 0 && (
              <ListRow
                to="/onboarding"
                leading={
                  <RowIcon tone="warn">
                    <Sparkles />
                  </RowIcon>
                }
                title="Finish setting up"
                value={`${onboarding!.completedCount} of ${onboarding!.totalCount}`}
              />
            )}
            {running > 0 && (
              <ListRow
                to="/jobs"
                leading={
                  <RowIcon>
                    <Loader />
                  </RowIcon>
                }
                title="Running now"
                value={`${running} job${running === 1 ? "" : "s"}`}
              />
            )}
            {checked.length > 0 && (
              <ListRow
                to="/settings/health"
                leading={
                  <RowIcon tone={failing ? "danger" : "accent"}>
                    <Activity />
                  </RowIcon>
                }
                title="Health"
                value={failing ? `${failing} failing` : "All OK"}
              />
            )}
          </ListSection>
        )}

        <nav aria-label="More pages" className={styles.sections}>
          {menu.moreSections.map((section) => (
            <ListSection key={section.id} title={section.label}>
              {section.items.map((item) => {
                const Icon = navIcon(item.to);
                return (
                  <ListRow
                    key={item.to}
                    to={item.to}
                    leading={
                      <RowIcon tone="neutral">
                        <Icon />
                      </RowIcon>
                    }
                    title={item.label}
                    value={navMeta(item, metrics) || undefined}
                  />
                );
              })}
            </ListSection>
          ))}
        </nav>
      </div>
    </PageShell>
  );
}

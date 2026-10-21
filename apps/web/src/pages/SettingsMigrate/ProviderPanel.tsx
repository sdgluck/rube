import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { FormSkeleton } from "#components/Skeleton";
import RelativeTime from "#components/RelativeTime";
import styles from "#pages/Settings/Settings.module.css";
import local from "./SettingsMigrate.module.css";
import CardSection from "#components/CardSection";
import Modal from "#components/Modal";
import SortableTh from "#components/SortableTh";
import { useLocalSort } from "#hooks/useLocalSort";

interface ProviderPanelProps {
  providerId: string;
  providerLabel: string;
}

/**
 * One per-provider tab in Settings → Migrate. Owns its own scan/run
 * state; the wrapper page just picks which provider to render. The plan
 * fields (proposed / future / unmappable) come straight from the
 * migrate package and have the same shape across every provider, so
 * this component is provider-agnostic.
 */
export default function ProviderPanel({ providerId, providerLabel }: ProviderPanelProps) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const statusQuery = trpc.migration.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const planQuery = trpc.migration.previewPlan.useQuery({ providerId }, { refetchOnWindowFocus: false });

  const scanMutation = trpc.migration.scan.useMutation();
  const runMutation = trpc.migration.run.useMutation();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOriginals, setDeleteOriginals] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Default-select every proposed item so the common case is one click.
  useEffect(() => {
    if (!planQuery.data) return;
    setSelected(new Set(planQuery.data.proposed.map((p) => p.key)));
  }, [planQuery.data]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalSelectedReplaces = useMemo(() => {
    if (!planQuery.data) return 0;
    return planQuery.data.proposed.filter((p) => selected.has(p.key)).reduce((sum, p) => sum + p.replacesCount, 0);
  }, [planQuery.data, selected]);

  // Some providers (MDBList, Trakt) don't replace existing Plex collections
  // — there's nothing to delete, so the toggle is hidden entirely.
  const planCanDeleteOriginals = useMemo(() => {
    return planQuery.data?.proposed.some((p) => p.replacesCount > 0) ?? false;
  }, [planQuery.data]);

  const handleScan = async () => {
    setScanning(true);
    try {
      await scanMutation.mutateAsync({ providerId });
      await Promise.all([utils.migration.status.invalidate(), utils.migration.previewPlan.invalidate({ providerId })]);
      addToast(`Re-scanned ${providerLabel} collections`, "success");
    } catch {
      addToast("Failed to re-scan", "error");
    } finally {
      setScanning(false);
    }
  };

  const handleRun = async () => {
    if (selected.size === 0) {
      addToast("Select at least one rule to migrate", "error");
      return;
    }
    const willDelete = planCanDeleteOriginals && deleteOriginals;

    setRunning(true);
    try {
      const result = await runMutation.mutateAsync({
        providerId,
        selectedKeys: [...selected],
        deleteOriginals: willDelete,
      });
      addToast("Migration started", "success");
      navigate(`/jobs/runs/${result.runId}`);
    } catch (err) {
      addToast(`Failed to start migration: ${(err as Error).message ?? err}`, "error");
    } finally {
      setRunning(false);
      setConfirmOpen(false);
    }
  };

  /**
   * Deleting originals goes through a real dialog rather than `confirm()`.
   * This is an irreversible delete of up to several hundred collections from
   * somebody's Plex server, and a browser confirm can't show the count in a
   * way that survives being skim-read.
   */
  const requestRun = () => {
    if (planCanDeleteOriginals && deleteOriginals && totalSelectedReplaces > 0) setConfirmOpen(true);
    else void handleRun();
  };

  // Above the early returns — the loading and error branches below bail out
  // before `plan` exists, and a hook can't run conditionally.
  const {
    sortKey,
    sortDir,
    toggleSort,
    sorted: sortedProposed,
  } = useLocalSort({
    rows: planQuery.data?.proposed ?? [],
    accessors: {
      ruleName: (p) => p.ruleName,
      ruleType: (p) => p.ruleType,
      sectionTitle: (p) => p.sectionTitle,
      replacesCount: (p) => p.replacesCount,
    },
    defaultKey: "ruleName",
    descFirst: ["replacesCount"],
  });

  if (statusQuery.isLoading || planQuery.isLoading) return <FormSkeleton rows={5} />;
  if (statusQuery.error || planQuery.error)
    return <div className={`${styles.toast} ${styles.error}`}>Failed to load migration data</div>;

  const status = statusQuery.data?.providers.find((p) => p.id === providerId);
  const plan = planQuery.data;
  if (!status || !plan) return null;

  return (
    <>
      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Status">
        {status.completedAt ? (
          <p className={styles.hint}>
            Migration completed <RelativeTime timestamp={status.completedAt} />.
          </p>
        ) : (
          <p className={styles.hint}>
            {status.count > 0
              ? `Found ${status.count} ${providerLabel}-managed collection(s)${status.scannedAt ? ", scanned " : ""}`
              : `No ${providerLabel}-managed collections detected.`}
            {status.scannedAt && status.count > 0 ? <RelativeTime timestamp={status.scannedAt} /> : null}
            {status.scannedAt && status.count > 0 ? "." : null}
          </p>
        )}
        {status.bySection.length > 0 && (
          <ul className={local.bulletsTight}>
            {status.bySection.map((s) => (
              <li key={s.sectionId}>
                {s.sectionTitle}: {s.count}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.buttons}>
          <button type="button" className={styles.buttonSecondary} onClick={handleScan} disabled={scanning}>
            {scanning ? "Scanning…" : "Re-scan"}
          </button>
        </div>
      </CardSection>

      <CardSection
        className={styles.group}
        titleClassName={styles.groupTitle}
        title={<>Proposed rules ({plan.proposed.length})</>}
      >
        {plan.proposed.length === 0 ? (
          <p className={styles.hint}>No rules to propose.</p>
        ) : (
          <p className={styles.hint}>
            One rule per bucket and library, created <strong>disabled</strong>.
          </p>
        )}
        {plan.proposed.length > 0 && (
          <div className="table-scroll in-panel">
            <table className={local.planTable}>
              <thead>
                <tr>
                  <th className={local.checkCol}>
                    <span className="sr-only">Include</span>
                  </th>
                  <SortableTh sortKey="ruleName" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Rule
                  </SortableTh>
                  <SortableTh sortKey="ruleType" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Type
                  </SortableTh>
                  <SortableTh sortKey="sectionTitle" activeKey={sortKey} activeDir={sortDir} onSort={toggleSort}>
                    Section
                  </SortableTh>
                  <SortableTh
                    sortKey="replacesCount"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onSort={toggleSort}
                    className={local.numCol}
                  >
                    Replaces
                  </SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedProposed.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                    </td>
                    <td>
                      <div>{p.ruleName}</div>
                      <div className={local.rowHint}>
                        e.g. {p.sampleNames.slice(0, 3).join(", ")}
                        {p.sampleNames.length > 3 ? ", …" : ""}
                      </div>
                    </td>
                    <td>
                      <code>{p.ruleType}</code>
                    </td>
                    <td>{p.sectionTitle}</td>
                    <td className={local.numCol}>{p.replacesCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardSection>

      {plan.future.length > 0 && (
        <CardSection
          className={styles.group}
          titleClassName={styles.groupTitle}
          title={<>Recognized but not yet supported ({plan.future.length})</>}
        >
          <p className={styles.hint}>Skipped — no matching Rube rule type yet.</p>
          <ul className={local.bullets}>
            {plan.future.map((f, i) => (
              <li key={`${f.bucket}-${f.sectionId}-${i}`}>
                <strong>{f.bucket}</strong> in {f.sectionTitle} — {f.count} collection(s).{" "}
                <span className={local.muted}>{f.note}</span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      {plan.unmappable.length > 0 && (
        <CardSection
          className={styles.group}
          titleClassName={styles.groupTitle}
          title={<>Unmappable ({plan.unmappable.length})</>}
        >
          <p className={styles.hint}>Left untouched, even when deleting originals.</p>
          <ul className={local.bulletsScroll}>
            {plan.unmappable.map((u) => (
              <li key={u.ratingKey}>
                {u.title} <span className={local.muted}>({u.sectionTitle})</span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}

      <CardSection className={styles.group} titleClassName={styles.groupTitle} title="Run migration">
        {planCanDeleteOriginals && (
          <>
            <label className={`${styles.field} ${local.inlineField}`}>
              <input type="checkbox" checked={deleteOriginals} onChange={(e) => setDeleteOriginals(e.target.checked)} />
              <span>
                Delete the {providerLabel}-managed collections behind the selected rules from Plex after creating them
              </span>
            </label>
            <p className={`${styles.hint} ${local.warnHint}`}>
              Selected rules replace <strong>{totalSelectedReplaces}</strong> {providerLabel} collection(s).
            </p>
          </>
        )}
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.button}
            onClick={requestRun}
            disabled={running || selected.size === 0}
          >
            {running ? "Starting…" : `Migrate ${selected.size} rule(s)`}
          </button>
        </div>
      </CardSection>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete the original collections?"
        size="sm"
        dismissOnBackdrop={false}
        footer={
          <>
            <button type="button" className={styles.buttonSecondary} onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button type="button" className={styles.button} onClick={() => void handleRun()} disabled={running}>
              {running ? "Starting…" : `Delete ${totalSelectedReplaces} and migrate`}
            </button>
          </>
        }
      >
        <p>
          <strong>{totalSelectedReplaces}</strong> {providerLabel} collection
          {totalSelectedReplaces === 1 ? "" : "s"} will be removed from Plex as soon as the rules are created.
        </p>
        <p className={styles.hint}>They stay missing until the rules first run. This can't be undone.</p>
      </Modal>
    </>
  );
}

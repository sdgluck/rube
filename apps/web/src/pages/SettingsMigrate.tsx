import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "../trpc";
import { useToast } from "../Toast";
import { FormSkeleton } from "../Skeleton";
import RelativeTime from "../RelativeTime";
import styles from "./Settings.module.css";

export default function SettingsMigrate() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const statusQuery = trpc.migration.status.useQuery(undefined, { refetchOnWindowFocus: false });
  const planQuery = trpc.migration.previewPlan.useQuery(undefined, { refetchOnWindowFocus: false });

  const scanMutation = trpc.migration.scan.useMutation();
  const runMutation = trpc.migration.run.useMutation();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOriginals, setDeleteOriginals] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);

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

  const handleScan = async () => {
    setScanning(true);
    try {
      await scanMutation.mutateAsync();
      await Promise.all([utils.migration.status.invalidate(), utils.migration.previewPlan.invalidate()]);
      addToast("Re-scanned Kometa collections", "success");
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
    if (
      deleteOriginals &&
      !confirm(
        `Delete ${totalSelectedReplaces} Kometa collection(s) from Plex after creating the rules? This cannot be undone.`,
      )
    ) {
      return;
    }

    setRunning(true);
    try {
      const result = await runMutation.mutateAsync({
        selectedKeys: [...selected],
        deleteOriginals,
      });
      addToast("Migration started", "success");
      navigate(`/jobs/runs/${result.runId}`);
    } catch (err) {
      addToast(`Failed to start migration: ${(err as Error).message ?? err}`, "error");
    } finally {
      setRunning(false);
    }
  };

  if (statusQuery.isLoading || planQuery.isLoading) return <FormSkeleton rows={5} />;
  if (statusQuery.error || planQuery.error)
    return <div className={`${styles.toast} ${styles.error}`}>Failed to load migration data</div>;

  const status = statusQuery.data;
  const plan = planQuery.data;
  if (!status || !plan) return null;

  return (
    <div className={styles.form} style={{ maxWidth: 880 }}>
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Status</legend>
        {status.completedAt ? (
          <p className={styles.hint}>
            Migration completed <RelativeTime timestamp={status.completedAt} />.
          </p>
        ) : (
          <p className={styles.hint}>
            {status.count > 0
              ? `Found ${status.count} Kometa-labelled collection(s)${status.scannedAt ? ", scanned " : ""}`
              : "No Kometa-labelled collections detected."}
            {status.scannedAt && status.count > 0 ? <RelativeTime timestamp={status.scannedAt} /> : null}
            {status.scannedAt && status.count > 0 ? "." : null}
          </p>
        )}
        {status.bySection.length > 0 && (
          <ul style={{ margin: "0 0 12px 0", paddingLeft: 20, lineHeight: 1.6 }}>
            {status.bySection.map((s) => (
              <li key={s.sectionId}>
                {s.sectionTitle}: {s.count}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.buttons}>
          <button type="button" className={styles.buttonSecondary} onClick={handleScan} disabled={scanning}>
            {scanning ? "Scanning..." : "Re-scan"}
          </button>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Proposed rules ({plan.proposed.length})</legend>
        {plan.proposed.length === 0 ? (
          <p className={styles.hint}>
            No rules to propose. Either no Kometa collections were found, or none classified into a supported bucket.
          </p>
        ) : (
          <p className={styles.hint}>
            One rule per (bucket, section). Created rules are <strong>disabled</strong> by default — review and enable
            them on the Rules page after migration.
          </p>
        )}
        {plan.proposed.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-input)" }}>
                <th style={{ padding: "8px 4px", width: 32 }}></th>
                <th style={{ padding: "8px 4px" }}>Rule</th>
                <th style={{ padding: "8px 4px" }}>Type</th>
                <th style={{ padding: "8px 4px" }}>Section</th>
                <th style={{ padding: "8px 4px", textAlign: "right" }}>Replaces</th>
              </tr>
            </thead>
            <tbody>
              {plan.proposed.map((p) => (
                <tr key={p.key} style={{ borderBottom: "1px solid var(--border-input)" }}>
                  <td style={{ padding: "8px 4px" }}>
                    <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                  </td>
                  <td style={{ padding: "8px 4px" }}>
                    <div>{p.ruleName}</div>
                    <div style={{ color: "var(--color-muted, #888)", fontSize: "0.85rem" }}>
                      e.g. {p.sampleNames.slice(0, 3).join(", ")}
                      {p.sampleNames.length > 3 ? ", …" : ""}
                    </div>
                  </td>
                  <td style={{ padding: "8px 4px" }}>
                    <code>{p.ruleType}</code>
                  </td>
                  <td style={{ padding: "8px 4px" }}>{p.sectionTitle}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{p.replacesCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </fieldset>

      {plan.future.length > 0 && (
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Recognized but not yet supported ({plan.future.length})</legend>
          <p className={styles.hint}>
            These Kometa collections classify into known buckets that don't have a Tinkerbell rule type yet. They'll be
            skipped by this migration; future Tinkerbell releases will add the missing rule types.
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            {plan.future.map((f, i) => (
              <li key={`${f.bucket}-${f.sectionId}-${i}`}>
                <strong>{f.bucket}</strong> in {f.sectionTitle} — {f.count} collection(s).{" "}
                <span style={{ color: "var(--color-muted, #888)" }}>{f.note}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {plan.unmappable.length > 0 && (
        <fieldset className={styles.group}>
          <legend className={styles.groupTitle}>Unmappable ({plan.unmappable.length})</legend>
          <p className={styles.hint}>
            These Kometa-labelled collections didn't classify into any known bucket. They'll be left untouched by the
            migration.
            {deleteOriginals &&
              " Delete-originals only removes collections behind selected proposed rules, so these are safe."}
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, maxHeight: 220, overflowY: "auto" }}>
            {plan.unmappable.map((u) => (
              <li key={u.ratingKey}>
                {u.title} <span style={{ color: "var(--color-muted, #888)" }}>({u.sectionTitle})</span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>Run migration</legend>
        <label className={styles.field} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <input type="checkbox" checked={deleteOriginals} onChange={(e) => setDeleteOriginals(e.target.checked)} />
          <span>Delete the Kometa-labelled collections behind the selected rules from Plex after creating them</span>
        </label>
        <p className={styles.hint} style={{ color: "var(--color-warn, #c97a00)" }}>
          Selected rules will replace <strong>{totalSelectedReplaces}</strong> Kometa collection(s).
          {deleteOriginals
            ? " Originals will be deleted from Plex — this cannot be undone."
            : " Originals will be left in Plex; you can clean them up later."}
        </p>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleRun} disabled={running || selected.size === 0}>
            {running ? "Starting..." : `Migrate ${selected.size} rule(s)`}
          </button>
        </div>
      </fieldset>
    </div>
  );
}

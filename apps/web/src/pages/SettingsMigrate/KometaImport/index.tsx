import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import Modal from "#components/Modal";
import Spinner from "#components/Spinner";
import styles from "#pages/Settings/Settings.module.css";
import local from "../SettingsMigrate.module.css";
import SourceStep, { type SourceMode } from "./SourceStep";
import ResolveStep, { type ImportSummary } from "./ResolveStep";
import ReviewStep from "./ReviewStep";

type StepId = "source" | "resolve" | "review" | "options";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "source", label: "Your config" },
  { id: "resolve", label: "What we found" },
  { id: "review", label: "Review" },
  { id: "options", label: "Migrate" },
];

/** Only YAML is worth sending; a config folder is full of logs and assets. */
const YAML_RE = /\.ya?ml$/i;
const MAX_FILES = 200;

interface KometaImportProps {
  providerId: string;
  /** Switches the page to the collection-scanning provider instead. */
  onFallbackToScan: () => void;
}

/**
 * The Kometa config importer.
 *
 * Four steps, in the order the questions actually arise: where's your config,
 * what did we find in it, what will each collection become, and how should we
 * apply it. The middle two exist because a migration nobody can check is a
 * migration nobody should run — see the notes on each step.
 */
export default function KometaImport({ providerId, onFallbackToScan }: KometaImportProps) {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [step, setStep] = useState<StepId>("source");
  const [mode, setMode] = useState<SourceMode>("server");
  const [serverPath, setServerPath] = useState("/config");
  const [pastedText, setPastedText] = useState("");
  const [files, setFiles] = useState<Array<{ path: string; text: string }>>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [sectionMap, setSectionMap] = useState<Record<string, string>>({});

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enableRules, setEnableRules] = useState(false);
  const [applyOverlays, setApplyOverlays] = useState(false);
  const [applyMetadata, setApplyMetadata] = useState(true);
  const [deleteOriginals, setDeleteOriginals] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const importMutation = trpc.migration.importFiles.useMutation();
  const setSectionMapMutation = trpc.migration.setSectionMap.useMutation();
  const runMutation = trpc.migration.run.useMutation();

  const overlaysQuery = trpc.migration.previewOverlays.useQuery(
    { importId: summary?.importId ?? "" },
    { enabled: !!summary?.importId && step === "options", refetchOnWindowFocus: false },
  );

  const metadataQuery = trpc.migration.previewMetadata.useQuery(
    { importId: summary?.importId ?? "" },
    { enabled: !!summary?.importId && step === "options", refetchOnWindowFocus: false },
  );

  const planQuery = trpc.migration.previewPlan.useQuery(
    { providerId, importId: summary?.importId },
    { enabled: step === "review" || step === "options", refetchOnWindowFocus: false },
  );

  // Everything is selected by default: the common case is "yes, all of it",
  // and partial rules are held back by being created disabled rather than by
  // being unticked, which would hide them.
  useEffect(() => {
    if (!planQuery.data) return;
    setSelected(new Set(planQuery.data.proposed.map((p) => p.key)));
  }, [planQuery.data]);

  const handleFilesPicked = (picked: FileList) => {
    setSourceError(null);
    void (async () => {
      const yaml = [...picked].filter((f) => YAML_RE.test(f.name)).slice(0, MAX_FILES);
      if (yaml.length === 0) {
        setSourceError("No YAML files in that selection — pick your Kometa config folder.");
        return;
      }
      const read = await Promise.all(
        yaml.map(async (f) => ({
          // `webkitRelativePath` keeps the folder structure Kometa's own
          // `file:` references are written against; a bare name would break
          // every include.
          path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          text: await f.text(),
        })),
      );
      setFiles(read);
    })();
  };

  const handleAnalyse = async () => {
    setSourceError(null);
    if (mode === "scan") {
      onFallbackToScan();
      return;
    }

    const payload =
      mode === "server"
        ? { serverPath: serverPath.trim() }
        : files.length > 0
          ? { files }
          : pastedText.trim()
            ? { files: [{ path: "config.yml", text: pastedText }] }
            : null;

    if (!payload) {
      setSourceError("Pick your config folder, or paste your config.yml.");
      return;
    }

    try {
      const result = await importMutation.mutateAsync(payload);
      setSummary(result);
      // Prefill from the title match the server guessed, but leave it editable
      // — a renamed library would otherwise migrate somewhere wrong silently.
      setSectionMap(
        Object.fromEntries(
          result.libraries.filter((l) => l.suggestedSectionId).map((l) => [l.name, l.suggestedSectionId!]),
        ),
      );
      setStep("resolve");
    } catch (err) {
      setSourceError((err as Error).message ?? "Couldn't read that config.");
    }
  };

  const handleConfirmSections = async () => {
    if (!summary) return;
    try {
      await setSectionMapMutation.mutateAsync({ importId: summary.importId, sectionMap });
      setStep("review");
    } catch (err) {
      addToast((err as Error).message ?? "Couldn't save the library mapping", "error");
    }
  };

  const selectedItems = useMemo(
    () => (planQuery.data?.proposed ?? []).filter((p) => selected.has(p.key)),
    [planQuery.data, selected],
  );
  const totalReplaces = selectedItems.reduce((sum, p) => sum + p.replacesCount, 0);
  const overlayBadgeCount = (overlaysQuery.data ?? []).reduce((sum, o) => sum + o.configs.length, 0);
  const metadataCount = (metadataQuery.data ?? []).reduce((sum, m) => sum + m.count, 0);
  const metadataSamples = (metadataQuery.data ?? []).flatMap((m) => m.samples).slice(0, 3);

  const handleRun = async () => {
    if (!summary || selected.size === 0) return;
    setRunning(true);
    try {
      const result = await runMutation.mutateAsync({
        providerId,
        importId: summary.importId,
        selectedKeys: [...selected],
        deleteOriginals: deleteOriginals && totalReplaces > 0,
        enableRules,
        applyOverlays,
        applyMetadata,
      });
      addToast("Migration started", "success");
      navigate(`/jobs/runs/${result.runId}`);
    } catch (err) {
      addToast(`Couldn't start the migration: ${(err as Error).message ?? err}`, "error");
    } finally {
      setRunning(false);
      setConfirmOpen(false);
    }
  };

  const stepIdx = STEPS.findIndex((s) => s.id === step);

  return (
    <>
      <ol className={local.stepStrip}>
        {STEPS.map((s, i) => (
          <li key={s.id} className={i === stepIdx ? local.stepActive : i < stepIdx ? local.stepDone : undefined}>
            <button
              type="button"
              className={local.stepButton}
              // Only backwards: a later step's data doesn't exist yet.
              disabled={i >= stepIdx}
              onClick={() => setStep(s.id)}
            >
              <span className={local.stepDot}>{i < stepIdx ? "✓" : i + 1}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      {step === "source" && (
        <SourceStep
          mode={mode}
          serverPath={serverPath}
          pastedText={pastedText}
          fileCount={files.length}
          error={sourceError}
          onModeChange={setMode}
          onServerPathChange={setServerPath}
          onPastedTextChange={setPastedText}
          onFilesPicked={handleFilesPicked}
        />
      )}

      {step === "resolve" && summary && (
        <ResolveStep
          summary={summary}
          sections={sectionsQuery.data ?? []}
          sectionMap={sectionMap}
          onSectionChange={(library, sectionId) =>
            setSectionMap((prev) => {
              const next = { ...prev };
              if (sectionId) next[library] = sectionId;
              else delete next[library];
              return next;
            })
          }
        />
      )}

      {(step === "review" || step === "options") && planQuery.isLoading && (
        <p className={styles.hint}>
          <Spinner size="xs" /> Working out what each collection becomes…
        </p>
      )}

      {step === "review" && planQuery.data && (
        <ReviewStep
          proposed={planQuery.data.proposed}
          unmappable={planQuery.data.unmappable}
          selected={selected}
          onToggle={(key) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onToggleMany={(keys, on) =>
            setSelected((prev) => {
              const next = new Set(prev);
              for (const k of keys) {
                if (on) next.add(k);
                else next.delete(k);
              }
              return next;
            })
          }
        />
      )}

      {step === "options" && planQuery.data && (
        <div className={styles.form}>
          <p className={styles.hint}>
            About to create <strong>{selected.size}</strong> rule{selected.size === 1 ? "" : "s"}.
          </p>

          <label className={`${styles.field} ${local.inlineField}`}>
            <input type="checkbox" checked={enableRules} onChange={(e) => setEnableRules(e.target.checked)} />
            <span>
              Switch the new rules on straight away
              <span className={local.muted}>
                {" "}
                — off by default so you can look before they touch Plex. Rules marked “partial” stay off either way.
              </span>
            </span>
          </label>

          {metadataCount > 0 && (
            <>
              <label className={`${styles.field} ${local.inlineField}`}>
                <input type="checkbox" checked={applyMetadata} onChange={(e) => setApplyMetadata(e.target.checked)} />
                <span>Keep your {metadataCount} hand-written item edit(s)</span>
              </label>
              <p className={styles.hint}>
                Titles, sort titles, summaries and genres you set per film or show
                {metadataSamples.length > 0 ? ` — ${metadataSamples.join(", ")}, …` : ""}. They're stored now and
                written to Plex by the metadata job, which only runs if metadata writing is switched on in Settings.
              </p>
            </>
          )}

          {overlayBadgeCount > 0 && (
            <>
              <label className={`${styles.field} ${local.inlineField}`}>
                <input type="checkbox" checked={applyOverlays} onChange={(e) => setApplyOverlays(e.target.checked)} />
                <span>
                  Rebuild your overlay badges ({overlayBadgeCount} across {overlaysQuery.data?.length ?? 0} librar
                  {(overlaysQuery.data?.length ?? 0) === 1 ? "y" : "ies"})
                </span>
              </label>
              <p className={`${styles.hint} ${local.warnHint}`}>
                {applyOverlays
                  ? "This replaces whatever overlay layout those libraries already have. Tinkerbell draws text badges rather than Kometa's images, so ribbons, logos and language flags aren't included — the review notes list what was left out."
                  : "Your Kometa overlay layout won't be recreated. You can set it up yourself on the Overlays page."}
              </p>
            </>
          )}

          {totalReplaces > 0 && (
            <>
              <label className={`${styles.field} ${local.inlineField}`}>
                <input
                  type="checkbox"
                  checked={deleteOriginals}
                  onChange={(e) => setDeleteOriginals(e.target.checked)}
                />
                <span>Delete the {totalReplaces} Kometa collection(s) these rules replace</span>
              </label>
              <p className={`${styles.hint} ${local.warnHint}`}>
                {deleteOriginals
                  ? "They're deleted as soon as the rules are created — before any rule has run, so there'll be a gap until the first run rebuilds them. This can't be undone."
                  : "They'll be left alone. Tinkerbell's rules will take them over on the first run."}
              </p>
            </>
          )}
        </div>
      )}

      <div className={styles.buttons}>
        {stepIdx > 0 && (
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={() => setStep(STEPS[stepIdx - 1]!.id)}
            disabled={running}
          >
            Back
          </button>
        )}

        {step === "source" && (
          <button type="button" className={styles.button} onClick={handleAnalyse} disabled={importMutation.isPending}>
            {importMutation.isPending ? (
              <>
                <Spinner size="xs" /> Reading…
              </>
            ) : mode === "scan" ? (
              "Scan Plex instead"
            ) : (
              "Read my config"
            )}
          </button>
        )}

        {step === "resolve" && (
          <button
            type="button"
            className={styles.button}
            onClick={handleConfirmSections}
            disabled={Object.keys(sectionMap).length === 0 || setSectionMapMutation.isPending}
          >
            Continue
          </button>
        )}

        {step === "review" && (
          <button
            type="button"
            className={styles.button}
            onClick={() => setStep("options")}
            disabled={selected.size === 0}
          >
            Continue with {selected.size} rule{selected.size === 1 ? "" : "s"}
          </button>
        )}

        {step === "options" && (
          <button
            type="button"
            className={styles.button}
            onClick={() => (deleteOriginals && totalReplaces > 0 ? setConfirmOpen(true) : void handleRun())}
            disabled={running || selected.size === 0}
          >
            {running ? "Starting…" : `Create ${selected.size} rule${selected.size === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

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
              {running ? "Starting…" : `Delete ${totalReplaces} and migrate`}
            </button>
          </>
        }
      >
        <p>
          <strong>{totalReplaces}</strong> Kometa collection{totalReplaces === 1 ? "" : "s"} will be removed from Plex
          as soon as the rules are created.
        </p>
        <p className={styles.hint}>
          The rules haven't run yet at that point, so the collections will be missing from Plex until the first run
          rebuilds them. This can't be undone.
        </p>
      </Modal>
    </>
  );
}

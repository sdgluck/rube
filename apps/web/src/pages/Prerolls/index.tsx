import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import SettingsPageLink from "#components/SettingsPageLink";
import ErrorState from "#components/ErrorState";
import PageShell from "#components/PageShell";
import ConfirmModal from "#components/ConfirmModal";
import Banner from "#components/Banner";
import BulkBar from "#components/BulkBar";
import { PrerollsSkeleton } from "#components/Skeleton";
import controls from "#/styles/controls.module.css";
import UploadModal from "./UploadModal";
import UploadDropzone, { UploadProgressList } from "./UploadDropzone";
import PrerollCard from "./PrerollCard";
import PrerollDetailModal from "./PrerollDetailModal";
import PlexSyncBar from "./PlexSyncBar";
import ImportUrlModal from "./ImportUrlModal";
import ImportExistingModal from "./ImportExistingModal";
import { uploadPreroll, stripExtension } from "./upload";
import { hasWorkInFlight } from "./utils";
import type { PrerollMode, UploadItem } from "./types";
import styles from "./Prerolls.module.css";

/** Fast enough that an encode's progress feels live, slow enough to be free. */
const ACTIVE_POLL_MS = 1500;

export default function Prerolls() {
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importExistingOpen, setImportExistingOpen] = useState(false);
  const lastClickedRef = useRef<string | null>(null);
  const dragRef = useRef<{ from: string; over: string | null }>({ from: "", over: null });

  const listQuery = trpc.prerolls.list.useQuery(undefined, {
    // Self-disabling poll, the same shape as Jobs → JobRun: only spend
    // requests while something is actually moving.
    refetchInterval: (query) => (query.state.data && hasWorkInFlight(query.state.data) ? ACTIVE_POLL_MS : false),
  });
  const envQuery = trpc.prerolls.environment.useQuery();
  const plexStatusQuery = trpc.prerolls.plexStatus.useQuery(undefined, { refetchOnWindowFocus: true });

  const invalidateAll = useCallback(() => {
    utils.prerolls.list.invalidate();
    utils.prerolls.plexStatus.invalidate();
    // A delete puts nothing back in the folder, but an adopt takes something
    // out of it — either way the scan result is stale after a mutation.
    utils.prerolls.scanExisting.invalidate();
    utils.nav.metrics.invalidate();
  }, [utils]);

  const updateMutation = trpc.prerolls.update.useMutation({ onSuccess: invalidateAll });
  const reorderMutation = trpc.prerolls.reorder.useMutation({ onSuccess: invalidateAll });
  const deleteManyMutation = trpc.prerolls.deleteMany.useMutation({ onSuccess: invalidateAll });
  const setModeMutation = trpc.prerolls.setMode.useMutation({
    onSuccess: () => {
      utils.prerolls.environment.invalidate();
      utils.prerolls.plexStatus.invalidate();
    },
  });
  const syncMutation = trpc.prerolls.sync.useMutation({ onSuccess: () => utils.prerolls.plexStatus.invalidate() });

  const prerolls = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const mode = envQuery.data?.mode ?? "random";
  const ffmpegMissing = envQuery.data ? envQuery.data.ffmpeg === null : false;
  // The card is made and edited in Settings → Portal, so this only offers the
  // way there — and stops offering once it exists, when its own card links back.
  const hasPortalCard = prerolls.some((p) => p.kind === "portal");
  const enabledCount = prerolls.filter((p) => p.enabled === 1 && p.status === "ready").length;

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const key = `${file.name}-${file.size}-${crypto.randomUUID()}`;
        setUploads((prev) => [...prev, { key, filename: stripExtension(file.name), progress: 0 }]);
        try {
          await uploadPreroll(file, {
            onProgress: (fraction) =>
              setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, progress: fraction } : u))),
          });
          setUploads((prev) => prev.filter((u) => u.key !== key));
          invalidateAll();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          // Kept in the list rather than toasted away, so a failed file in a
          // multi-file drop stays attributable to its filename.
          setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, error: message } : u)));
          addToast(`${file.name}: ${message}`, "error");
        }
      }
    },
    [addToast, invalidateAll],
  );

  const handleSelect = useCallback(
    (id: string, isSelected: boolean, shiftKey: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const anchor = lastClickedRef.current;
        if (shiftKey && anchor) {
          const ids = prerolls.map((p) => p.id);
          const from = ids.indexOf(anchor);
          const to = ids.indexOf(id);
          if (from !== -1 && to !== -1) {
            for (const rangeId of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
              if (isSelected) next.add(rangeId);
              else next.delete(rangeId);
            }
          }
        } else if (isSelected) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      });
      lastClickedRef.current = id;
    },
    [prerolls],
  );

  async function handleToggleEnabled(id: string, enabled: boolean) {
    try {
      await updateMutation.mutateAsync({ id, enabled });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't update that preroll", "error");
    }
  }

  async function handleModeChange(next: PrerollMode) {
    if (next === mode) return;
    try {
      await setModeMutation.mutateAsync({ mode: next });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't change the playback order", "error");
    }
  }

  async function handleSync() {
    try {
      const result = await syncMutation.mutateAsync();
      if (result.inSync) {
        addToast(result.expected ? "Plex updated" : "Prerolls cleared in Plex", "success");
      } else {
        addToast("Plex accepted the request but reports a different value — check the path mapping", "error");
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't reach Plex", "error");
    }
  }

  async function handleDeleteConfirmed() {
    const ids = confirmDelete ?? [];
    setConfirmDelete(null);
    try {
      const { deleted } = await deleteManyMutation.mutateAsync({ ids });
      setSelected(new Set());
      setOpenId(null);
      addToast(deleted === 1 ? "Preroll deleted" : `${deleted} prerolls deleted`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Couldn't delete", "error");
    }
  }

  function handleDrop() {
    const { from, over } = dragRef.current;
    dragRef.current = { from: "", over: null };
    if (!from || !over || from === over) return;
    const ids = prerolls.map((p) => p.id);
    const next = ids.filter((id) => id !== from);
    next.splice(next.indexOf(over), 0, from);
    reorderMutation.mutate({ ids: next });
  }

  const openPreroll = openId ? prerolls.find((p) => p.id === openId) : undefined;

  if (listQuery.isLoading) return <PrerollsSkeleton />;
  if (listQuery.error) {
    return <ErrorState title="Couldn't load prerolls" error={listQuery.error} onRetry={() => listQuery.refetch()} />;
  }

  return (
    <PageShell
      count={prerolls.length > 0 ? prerolls.length : undefined}
      actions={
        <>
          {!hasPortalCard && !ffmpegMissing && (
            <Link to="/settings/portal/preroll" className={`${controls.btn} ${controls.btnSecondary}`}>
              Add portal card
            </Link>
          )}
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary}`}
            onClick={() => setImportExistingOpen(true)}
            disabled={ffmpegMissing}
          >
            Import existing
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnSecondary}`}
            onClick={() => setImportOpen(true)}
            disabled={ffmpegMissing}
          >
            Import from URL
          </button>
          <button
            type="button"
            className={`${controls.btn} ${controls.btnPrimary}`}
            onClick={() => setUploadOpen(true)}
            disabled={ffmpegMissing}
          >
            Upload
          </button>
        </>
      }
    >
      {ffmpegMissing && (
        <Banner variant="error">
          ffmpeg isn't available, so uploads can't be processed. <SettingsPageLink to="/settings/prerolls" />
        </Banner>
      )}

      {/* Above the grid: what Plex is actually playing is the state this page
          is about, and at the foot of a long grid it was the last thing read
          rather than the first. */}
      <PlexSyncBar
        enabledCount={enabledCount}
        mode={mode}
        status={plexStatusQuery.data}
        syncing={syncMutation.isPending}
        onModeChange={handleModeChange}
        onSync={handleSync}
      />

      <UploadProgressList uploads={uploads} />

      {prerolls.length === 0 ? (
        // With nothing to show, the page *is* the upload target — a modal
        // behind a header button is one step too many for the first clip.
        <div className={styles.emptyUpload}>
          <UploadDropzone disabled={ffmpegMissing} onFiles={handleFiles} />
          <div className={styles.emptyActions}>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
              onClick={() => setImportOpen(true)}
              disabled={ffmpegMissing}
            >
              Import from URL
            </button>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
              onClick={() => setImportExistingOpen(true)}
              disabled={ffmpegMissing}
              title="Videos already in the prerolls folder"
            >
              Import existing
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.grid} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
          {prerolls.map((preroll) => (
            <PrerollCard
              key={preroll.id}
              preroll={preroll}
              selected={selected.has(preroll.id)}
              ordered={mode === "sequential"}
              onSelect={handleSelect}
              onToggleEnabled={handleToggleEnabled}
              onOpen={setOpenId}
              onDragStart={(id) => {
                dragRef.current = { from: id, over: null };
              }}
              onDragOver={(id) => {
                dragRef.current.over = id;
              }}
              onDragEnd={handleDrop}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          noun="preroll"
          onClear={() => setSelected(new Set())}
          actions={[
            { label: `Delete ${selected.size}`, tone: "danger", onClick: () => setConfirmDelete([...selected]) },
          ]}
        />
      )}

      {uploadOpen && (
        <UploadModal disabled={ffmpegMissing} onClose={() => setUploadOpen(false)} onFiles={handleFiles} />
      )}

      {openPreroll && (
        <PrerollDetailModal
          preroll={openPreroll}
          onClose={() => setOpenId(null)}
          onDelete={(id) => setConfirmDelete([id])}
        />
      )}

      {importOpen && <ImportUrlModal onClose={() => setImportOpen(false)} onImported={invalidateAll} />}

      {importExistingOpen && (
        <ImportExistingModal onClose={() => setImportExistingOpen(false)} onImported={invalidateAll} />
      )}

      {confirmDelete && (
        <ConfirmModal
          danger
          title={confirmDelete.length === 1 ? "Delete this preroll?" : `Delete ${confirmDelete.length} prerolls?`}
          message="The video files are removed from disk and Plex stops playing them. This can't be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </PageShell>
  );
}

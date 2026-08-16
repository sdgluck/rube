import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { PosterCanvas, type BadgeLayout, type CanvasBadge } from "#lib/PosterCanvas";
import ConfirmModal from "#components/ConfirmModal";
import DropdownButton from "#components/DropdownButton";
import FeatureStatusBanner from "#components/FeatureStatusBanner";
import PageShell from "#components/PageShell";
import { PageSkeleton } from "#components/Skeleton";
import ErrorState from "#components/ErrorState";
import Spinner from "#components/Spinner";
import type { OverlayPosition, OverlayType, BadgeStyle, ConditionalRule } from "@tinkerbell/contracts";
import shared from "#/styles/shared.module.css";
import styles from "./Overlays.module.css";
import { Inspector } from "./Overlays/Inspector";
import { PresetList } from "./Overlays/PresetList";
import { Catalog } from "./Overlays/Catalog";
import { BulkPreviewModal } from "./Overlays/BulkPreviewModal";
import { SavePresetModal } from "./Overlays/SavePresetModal";
import { ImportLayoutModal } from "./Overlays/ImportLayoutModal";
import { POSITIONS } from "./Overlays/constants";
import { getPlaceholderValue } from "./Overlays/helpers";

export default function Overlays() {
  const toast = useToast();
  // The sticky action bar at the bottom of this page covers the toast's
  // default 24px offset, so push the toast up while Overlays is mounted.
  // Toasts portal to document.body, so the variable lives there.
  useEffect(() => {
    document.body.style.setProperty("--toast-bottom", "80px");
    return () => {
      document.body.style.removeProperty("--toast-bottom");
    };
  }, []);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [dragOverPosition, setDragOverPosition] = useState<OverlayPosition | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [hidingBadges, setHidingBadges] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [badgeLayout, setBadgeLayout] = useState<BadgeLayout[]>([]);
  const [posterNatural, setPosterNatural] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [frameSize, setFrameSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const posterFrameRef = useRef<HTMLDivElement | null>(null);
  const frameObserverRef = useRef<ResizeObserver | null>(null);
  // Ref callback fires whenever the node mounts/unmounts, including across the
  // initial loading→loaded transition where the frame div appears in a later
  // render. A useEffect with [] deps would only see the ref's first value.
  const setPosterFrameRef = useCallback((el: HTMLDivElement | null) => {
    posterFrameRef.current = el;
    frameObserverRef.current?.disconnect();
    frameObserverRef.current = null;
    if (!el) {
      setFrameSize({ w: 0, h: 0 });
      return;
    }
    const update = () => {
      const rect = el.getBoundingClientRect();
      setFrameSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    frameObserverRef.current = ro;
  }, []);
  const [bulkItems, setBulkItems] = useState<Array<{ title: string; ratingKey: string; image: string }>>([]);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetDesc, setPresetDesc] = useState("");
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "append">("replace");
  const [importError, setImportError] = useState<string | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);

  const utils = trpc.useUtils();
  const sectionsQuery = trpc.plexSections.useQuery(undefined, { refetchOnWindowFocus: false, retry: false });
  const sections = (sectionsQuery.data || []).filter((s) => s.type === "movie" || s.type === "show");
  const sectionId = activeSection || sections[0]?.key || "";

  const configsQuery = trpc.overlays.configs.useQuery(
    { sectionId },
    { enabled: !!sectionId, refetchOnWindowFocus: false },
  );
  const statusQuery = trpc.overlays.status.useQuery({ sectionId }, { enabled: !!sectionId });
  const sampleQuery = trpc.overlays.sampleItem.useQuery(
    { sectionId },
    { enabled: !!sectionId, refetchOnWindowFocus: false, staleTime: Infinity },
  );
  const previewQuery = trpc.overlays.previewValues.useQuery(
    { sectionId, ratingKey: sampleQuery.data?.ratingKey || "" },
    { enabled: !!sectionId && !!sampleQuery.data?.ratingKey, refetchOnWindowFocus: false },
  );
  const presetsQuery = trpc.overlays.listPresets.useQuery(undefined, { refetchOnWindowFocus: false });

  const invalidateConfigs = useCallback(() => {
    utils.overlays.configs.invalidate({ sectionId });
    if (sampleQuery.data?.ratingKey) {
      utils.overlays.previewValues.invalidate({ sectionId, ratingKey: sampleQuery.data.ratingKey });
    }
  }, [utils, sectionId, sampleQuery.data?.ratingKey]);

  const onMutationError = useCallback(
    (label: string) => (err: { message?: string } | unknown) => {
      const msg = (err as { message?: string })?.message ?? "Unknown error";
      toast.addToast(`${label} failed: ${msg}`, "error");
    },
    [toast],
  );

  const addConfigMutation = trpc.overlays.addConfig.useMutation({
    onSuccess: invalidateConfigs,
    onError: onMutationError("Add overlay"),
  });
  const updateConfigMutation = trpc.overlays.updateConfig.useMutation({
    onSuccess: invalidateConfigs,
    onError: onMutationError("Update overlay"),
  });
  const removeConfigMutation = trpc.overlays.removeConfig.useMutation({
    onSuccess: invalidateConfigs,
    onError: onMutationError("Remove overlay"),
  });
  const moveConfigMutation = trpc.overlays.moveConfig.useMutation({
    onSuccess: invalidateConfigs,
    onError: onMutationError("Move overlay"),
  });
  const startJobMutation = trpc.jobs.start.useMutation();
  const bulkPreviewMutation = trpc.overlays.bulkPreview.useMutation({
    onSuccess: (data) => setBulkItems(data.items),
  });
  const applyPresetMutation = trpc.overlays.applyPreset.useMutation({
    onSuccess: () => {
      invalidateConfigs();
      toast.addToast("Preset applied", "success");
    },
  });
  const savePresetMutation = trpc.overlays.savePresetFromSection.useMutation({
    onSuccess: () => {
      utils.overlays.listPresets.invalidate();
      toast.addToast("Preset saved", "success");
      setSavePresetOpen(false);
      setPresetName("");
      setPresetDesc("");
    },
  });
  const deletePresetMutation = trpc.overlays.deletePreset.useMutation({
    onSuccess: () => {
      utils.overlays.listPresets.invalidate();
      toast.addToast("Preset deleted", "info");
    },
  });
  const clearConfigsMutation = trpc.overlays.clearConfigs.useMutation({
    onSuccess: () => {
      invalidateConfigs();
      setSelectedConfigId(null);
      toast.addToast("All overlays cleared", "info");
      setConfirmClearOpen(false);
    },
  });
  const importSectionMutation = trpc.overlays.importSection.useMutation({
    onSuccess: (data) => {
      invalidateConfigs();
      setSelectedConfigId(null);
      setImportOpen(false);
      setImportText("");
      setImportError(null);
      toast.addToast(`Imported ${data.count} overlay${data.count === 1 ? "" : "s"}`, "success");
    },
    onError: (err: { message?: string }) => {
      setImportError(err?.message ?? "Import failed");
    },
  });

  const handleExport = useCallback(async () => {
    try {
      const data = await utils.overlays.exportSection.fetch({ sectionId });
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const sectionName = sections.find((s) => s.key === sectionId)?.title ?? sectionId;
      const safeName = sectionName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const a = document.createElement("a");
      a.href = url;
      a.download = `overlays-${safeName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.addToast(`Exported ${data.configs.length} overlay${data.configs.length === 1 ? "" : "s"}`, "success");
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Export failed";
      toast.addToast(msg, "error");
    }
  }, [utils, sectionId, sections, toast]);

  const handleImport = useCallback(() => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError("Not valid JSON");
      return;
    }
    importSectionMutation.mutate({
      sectionId,
      mode: importMode,
      // Server-side Zod schema is the source of truth; we just shovel the
      // parsed object across and surface validation errors.
      data: parsed as never,
    });
  }, [importText, importMode, sectionId, importSectionMutation]);

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      setImportText(text);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not read file");
    }
  }, []);

  const configs = configsQuery.data ?? [];
  const previewValues = (previewQuery.data ?? {}) as Record<number, string | null>;
  const selected = configs.find((c) => c.id === selectedConfigId) ?? null;

  // Group configs by position for stacked rendering.
  const configsByPosition = useMemo(() => {
    const map = new Map<OverlayPosition, typeof configs>();
    for (const pos of POSITIONS) map.set(pos.id, []);
    for (const c of configs) {
      const list = map.get(c.position as OverlayPosition);
      if (list) list.push(c);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [configs]);

  // Reset selection when section changes.
  useEffect(() => {
    setSelectedConfigId(null);
  }, [sectionId]);

  // Track drag state globally so drop zones only render during a drag.
  useEffect(() => {
    const onStart = () => setIsDragging(true);
    const onEnd = () => {
      setIsDragging(false);
      setDragOverPosition(null);
    };
    window.addEventListener("dragstart", onStart);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragstart", onStart);
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);

  // Close overflow menu on outside click.
  useEffect(() => {
    if (!overflowOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [overflowOpen]);

  // Keyboard: Delete to remove selected, arrows to nudge between zones.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selectedConfigId == null) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedConfigId(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeConfigMutation.mutate({ id: selectedConfigId });
        setSelectedConfigId(null);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const cur = configs.find((c) => c.id === selectedConfigId);
        if (!cur) return;
        const idx = POSITIONS.findIndex((p) => p.id === cur.position);
        const next = e.key === "ArrowLeft" ? Math.max(0, idx - 1) : Math.min(POSITIONS.length - 1, idx + 1);
        if (next !== idx) {
          e.preventDefault();
          moveConfigMutation.mutate({ id: selectedConfigId, position: POSITIONS[next].id, order: 999 });
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // Step semantics:
        //   1. If the chip can move within its stack, reorder there first.
        //   2. Otherwise, jump to the same column in the adjacent row
        //      (top → middle → bottom on ArrowDown; reverse on ArrowUp).
        const cur = configs.find((c) => c.id === selectedConfigId);
        if (!cur) return;
        const stack = configs.filter((c) => c.position === cur.position).sort((a, b) => a.order - b.order);
        const stackIdx = stack.findIndex((c) => c.id === selectedConfigId);
        const stackTarget = e.key === "ArrowUp" ? stackIdx - 1 : stackIdx + 1;
        if (stackIdx >= 0 && stackTarget >= 0 && stackTarget < stack.length) {
          e.preventDefault();
          moveConfigMutation.mutate({
            id: selectedConfigId,
            position: cur.position as OverlayPosition,
            order: stackTarget,
          });
          return;
        }
        // Stack boundary — try a row jump. Positions are laid out 3 per row:
        //   0..2 top, 3..5 middle, 6..8 bottom. Same column = same idx % 3.
        const idx = POSITIONS.findIndex((p) => p.id === cur.position);
        const next = e.key === "ArrowDown" ? idx + 3 : idx - 3;
        if (idx >= 0 && next >= 0 && next < POSITIONS.length) {
          e.preventDefault();
          moveConfigMutation.mutate({ id: selectedConfigId, position: POSITIONS[next].id, order: 999 });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedConfigId, configs, removeConfigMutation, moveConfigMutation]);

  const handleDropFromCatalog = useCallback(
    (position: OverlayPosition, overlayType: OverlayType) => {
      setDragOverPosition(null);
      addConfigMutation.mutate({ sectionId, position, overlayType });
    },
    [sectionId, addConfigMutation],
  );

  const handleMoveExisting = useCallback(
    (id: number, position: OverlayPosition) => {
      setDragOverPosition(null);
      moveConfigMutation.mutate({ id, position, order: 999 });
    },
    [moveConfigMutation],
  );

  const handlePatchStyle = useCallback(
    (id: number, patch: Partial<BadgeStyle>) => {
      const current = configs.find((c) => c.id === id);
      if (!current) return;
      const next: BadgeStyle = { ...current.style, ...patch };
      // Strip undefined/empty fields.
      const clean: BadgeStyle = {};
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === "" || v === null) continue;
        (clean as Record<string, unknown>)[k] = v;
      }
      updateConfigMutation.mutate({ id, style: Object.keys(clean).length === 0 ? null : clean });
    },
    [configs, updateConfigMutation],
  );

  const handlePatchRule = useCallback(
    (id: number, patch: Partial<ConditionalRule>) => {
      const current = configs.find((c) => c.id === id);
      if (!current) return;
      const next: ConditionalRule = { ...current.rule, ...patch };
      const clean: ConditionalRule = {};
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null) continue;
        (clean as Record<string, unknown>)[k] = v;
      }
      updateConfigMutation.mutate({ id, rule: Object.keys(clean).length === 0 ? null : clean });
    },
    [configs, updateConfigMutation],
  );

  const handleShuffle = () => {
    utils.overlays.sampleItem.invalidate({ sectionId });
  };

  const posterUrl = sampleQuery.data?.thumb
    ? `/api/plex-image?path=${encodeURIComponent(sampleQuery.data.thumb)}`
    : null;

  // Build canvas badges from configs + resolved values. A null resolved value
  // falls back to the placeholder so the user can still see styling, unless the
  // rule says hideIfMissing.
  const canvasBadges: CanvasBadge[] = useMemo(() => {
    const out: CanvasBadge[] = [];
    for (const cfg of configs) {
      const value = previewValues[cfg.id];
      const display = value ?? (cfg.rule?.hideIfMissing ? null : getPlaceholderValue(cfg.overlayType));
      if (display == null) continue;
      out.push({
        id: cfg.id,
        position: cfg.position as OverlayPosition,
        type: cfg.overlayType as OverlayType,
        value: display,
        style: cfg.style ?? null,
        order: cfg.order,
      });
    }
    return out;
  }, [configs, previewValues]);

  const handleLayout = useCallback((layout: BadgeLayout[], naturalW: number, naturalH: number) => {
    setBadgeLayout(layout);
    setPosterNatural((prev) => (prev.w === naturalW && prev.h === naturalH ? prev : { w: naturalW, h: naturalH }));
  }, []);

  const displayRatio = posterNatural.w > 0 && frameSize.w > 0 ? frameSize.w / posterNatural.w : 0;

  if (sectionsQuery.isLoading) return <PageSkeleton />;
  if (sectionsQuery.error) {
    return (
      <ErrorState
        title="Couldn't load Plex libraries"
        error={sectionsQuery.error}
        onRetry={() => sectionsQuery.refetch()}
      />
    );
  }

  return (
    <PageShell
      actions={
        sections.length > 1 ? (
          <DropdownButton
            label={sections.find((s) => s.key === sectionId)?.title ?? "Library"}
            className={shared.buttonSecondary}
            options={sections.map((s) => ({ label: s.title, onClick: () => setActiveSection(s.key) }))}
          />
        ) : undefined
      }
    >
      <div className={styles.root}>
        <FeatureStatusBanner featureId="overlays" />

        {sections.length === 0 ? (
          <p>No movie or TV libraries found. Configure your Plex libraries in Settings.</p>
        ) : (
          <>
            <div className={styles.workspace}>
              {/* ─── Left: catalog + presets (separate panels) ────────── */}
              <div className={styles.catalogColumn}>
                <Catalog />
                <aside className={styles.catalog}>
                  <h3 className={styles.paneTitle}>Presets</h3>
                  <div className={styles.panelBody}>
                    <PresetList
                      presets={presetsQuery.data ?? []}
                      onApply={(id) => applyPresetMutation.mutate({ sectionId, presetId: id })}
                      onDelete={(id) => deletePresetMutation.mutate({ id })}
                      onSaveCurrent={() => setSavePresetOpen(true)}
                      canSave={configs.length > 0}
                    />
                  </div>
                </aside>
              </div>

              {/* ─── Center: poster canvas ───────────────────────────── */}
              <div className={styles.canvas}>
                <div className={styles.canvasHeader}>
                  <span className={styles.canvasTitle}>
                    {sampleQuery.data ? (
                      `${sampleQuery.data.title}${sampleQuery.data.year ? ` (${sampleQuery.data.year})` : ""}`
                    ) : (
                      <Spinner size="xs" />
                    )}
                  </span>
                  <div className={styles.canvasActions}>
                    <button
                      className={styles.iconActionBtn}
                      onClick={handleShuffle}
                      disabled={sampleQuery.isFetching}
                      title="Shuffle to a different sample poster"
                      aria-label="Shuffle"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="16 3 21 3 21 8" />
                        <line x1="4" y1="20" x2="21" y2="3" />
                        <polyline points="21 16 21 21 16 21" />
                        <line x1="15" y1="15" x2="21" y2="21" />
                        <line x1="4" y1="4" x2="9" y2="9" />
                      </svg>
                    </button>
                    <button
                      className={styles.iconActionBtn}
                      onMouseDown={() => setHidingBadges(true)}
                      onMouseUp={() => setHidingBadges(false)}
                      onMouseLeave={() => setHidingBadges(false)}
                      onTouchStart={() => setHidingBadges(true)}
                      onTouchEnd={() => setHidingBadges(false)}
                      disabled={canvasBadges.length === 0}
                      title="Hold to see the original poster"
                      aria-label="Show original"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div
                  ref={setPosterFrameRef}
                  className={styles.posterFrame}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={(e) => {
                    // Click on empty area deselects.
                    if (e.target === e.currentTarget) setSelectedConfigId(null);
                  }}
                >
                  {posterUrl ? (
                    <PosterCanvas
                      posterUrl={posterUrl}
                      badges={canvasBadges}
                      hideBadges={hidingBadges}
                      className={styles.posterImage}
                      alt="Sample poster"
                      onLayout={handleLayout}
                    />
                  ) : (
                    <div className={styles.posterPlaceholder}>No poster</div>
                  )}

                  {/* Drop targets at each corner. Visually surfaced only during a drag;
                    occupied zones still receive drops invisibly so users can stack. */}
                  {POSITIONS.map((pos) => {
                    const stack = configsByPosition.get(pos.id) ?? [];
                    const isOver = dragOverPosition === pos.id;
                    const isEmpty = stack.length === 0;
                    const showVisual = isDragging && isEmpty;

                    return (
                      <div
                        key={pos.id}
                        className={`${styles.dropZone} ${styles[`pos_${pos.id.replace("-", "_")}`]} ${isOver ? styles.dropZoneOver : ""} ${showVisual ? styles.dropZoneEmpty : styles.dropZoneOccupied}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOverPosition(pos.id);
                        }}
                        onDragLeave={() => setDragOverPosition(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          try {
                            const raw = e.dataTransfer.getData("text/plain");
                            const data = JSON.parse(raw);
                            if (data.kind === "new") handleDropFromCatalog(pos.id, data.type);
                            else if (data.kind === "move") handleMoveExisting(data.id, pos.id);
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        {showVisual && <span className={styles.dropZonePlaceholder}>{pos.label}</span>}
                      </div>
                    );
                  })}

                  {/* Hit boxes — absolutely positioned to the canvas-natural coords scaled by displayRatio */}
                  {!hidingBadges &&
                    displayRatio > 0 &&
                    badgeLayout.map((box) => {
                      if (box.id == null) return null;
                      const isSelected = selectedConfigId === box.id;
                      return (
                        <div
                          key={box.id}
                          className={`${styles.hitBox} ${isSelected ? styles.hitBoxSelected : ""}`}
                          style={{
                            left: `${box.left * displayRatio}px`,
                            top: `${box.top * displayRatio}px`,
                            width: `${box.width * displayRatio}px`,
                            height: `${box.height * displayRatio}px`,
                          }}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "move", id: box.id }));
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverPosition(box.position);
                          }}
                          onDragLeave={() => setDragOverPosition(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            try {
                              const raw = e.dataTransfer.getData("text/plain");
                              const data = JSON.parse(raw);
                              if (data.kind === "new") handleDropFromCatalog(box.position, data.type);
                              else if (data.kind === "move" && data.id !== box.id)
                                handleMoveExisting(data.id, box.position);
                            } catch {
                              /* ignore */
                            }
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedConfigId(box.id ?? null);
                          }}
                          title={POSITIONS.find((p) => p.id === box.position)?.label}
                        >
                          <button
                            className={styles.badgeRemove}
                            aria-label={`Remove ${POSITIONS.find((pos) => pos.id === box.position)?.label ?? "overlay"} overlay from layout`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (box.id != null) removeConfigMutation.mutate({ id: box.id });
                              if (box.id != null && selectedConfigId === box.id) setSelectedConfigId(null);
                            }}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* ─── Right: inspector + shortcuts ─────────────────────── */}
              <div className={styles.inspectorColumn}>
                <aside className={styles.inspector}>
                  {selected ? (
                    (() => {
                      const stack = configsByPosition.get(selected.position as OverlayPosition) ?? [];
                      const idx = stack.findIndex((c) => c.id === selected.id);
                      const canUp = idx > 0;
                      const canDown = idx >= 0 && idx < stack.length - 1;
                      return (
                        <Inspector
                          config={selected}
                          onPatchStyle={(p) => handlePatchStyle(selected.id, p)}
                          onPatchRule={(p) => handlePatchRule(selected.id, p)}
                          onResetStyle={() => updateConfigMutation.mutate({ id: selected.id, style: null })}
                          onResetRule={() => updateConfigMutation.mutate({ id: selected.id, rule: null })}
                          onRemove={() => {
                            removeConfigMutation.mutate({ id: selected.id });
                            setSelectedConfigId(null);
                          }}
                          onClose={() => setSelectedConfigId(null)}
                          onMoveUp={
                            canUp
                              ? () =>
                                  moveConfigMutation.mutate({
                                    id: selected.id,
                                    position: selected.position as OverlayPosition,
                                    order: idx - 1,
                                  })
                              : null
                          }
                          onMoveDown={
                            canDown
                              ? () =>
                                  moveConfigMutation.mutate({
                                    id: selected.id,
                                    position: selected.position as OverlayPosition,
                                    order: idx + 1,
                                  })
                              : null
                          }
                        />
                      );
                    })()
                  ) : configs.length === 0 && (presetsQuery.data?.length ?? 0) > 0 ? (
                    <div className={styles.inspectorEmpty}>
                      <h3 className={styles.paneTitle}>Quick start</h3>
                      <p className={styles.inspectorEmptyText}>
                        Apply a built-in preset, or drag overlays from the left.
                      </p>
                      <div className={styles.presetQuickList}>
                        {presetsQuery
                          .data!.filter((p) => p.builtIn)
                          .map((p) => (
                            <button
                              key={p.id}
                              className={styles.presetQuickItem}
                              onClick={() => applyPresetMutation.mutate({ sectionId, presetId: p.id })}
                              disabled={applyPresetMutation.isPending}
                            >
                              <span className={styles.presetQuickName}>{p.name}</span>
                              <span className={styles.presetQuickDesc}>{p.description}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.inspectorEmpty}>
                      <h3 className={styles.paneTitle}>Inspector</h3>
                      <p className={styles.inspectorEmptyText}>
                        Click a placed overlay to customize its label, color, size, shape, opacity, and visibility
                        rules.
                      </p>
                    </div>
                  )}
                </aside>
                <div className={styles.shortcutsPanel}>
                  <h3 className={styles.paneTitle}>Shortcuts</h3>
                  <div className={styles.shortcutsList}>
                    <span>
                      <kbd>↑↓←→</kbd> move
                    </span>
                    <span>
                      <kbd>Del</kbd> remove
                    </span>
                    <span>
                      <kbd>Esc</kbd> deselect
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Sticky bottom action bar ─────────────────────────── */}
            <div className={styles.actionBar}>
              <span className={styles.actionBarStatus}>
                {statusQuery.data ? (
                  `${statusQuery.data.count} item${statusQuery.data.count === 1 ? "" : "s"} have overlays applied`
                ) : (
                  <Spinner size="xs" />
                )}
              </span>
              <div className={styles.overflowWrap} ref={overflowRef}>
                <button
                  className={styles.actionBtnOverflow}
                  onClick={() => setOverflowOpen((v) => !v)}
                  aria-label="More actions"
                  title="More actions"
                >
                  ⋯
                </button>
                {overflowOpen && (
                  <div className={styles.overflowMenu} role="menu">
                    <button
                      className={styles.overflowItem}
                      onClick={() => {
                        setOverflowOpen(false);
                        handleExport();
                      }}
                      disabled={configs.length === 0}
                    >
                      Export layout…
                      <span className={styles.overflowItemHint}>Download this section's overlays as JSON</span>
                    </button>
                    <button
                      className={styles.overflowItem}
                      onClick={() => {
                        setOverflowOpen(false);
                        setImportText("");
                        setImportError(null);
                        setImportMode("replace");
                        setImportOpen(true);
                      }}
                    >
                      Import layout…
                      <span className={styles.overflowItemHint}>Load overlays from a JSON file</span>
                    </button>
                    <button
                      className={styles.overflowItem}
                      onClick={() => {
                        setOverflowOpen(false);
                        setConfirmClearOpen(true);
                      }}
                      disabled={configs.length === 0 || clearConfigsMutation.isPending}
                    >
                      Clear layout
                      <span className={styles.overflowItemHint}>Reset this section's overlays</span>
                    </button>
                    <button
                      className={`${styles.overflowItem} ${styles.overflowItemDanger}`}
                      onClick={() => {
                        setOverflowOpen(false);
                        startJobMutation.mutate({ jobId: "overlays-remove" });
                      }}
                      disabled={startJobMutation.isPending || (statusQuery.data?.count || 0) === 0}
                    >
                      Remove all from Plex
                      <span className={styles.overflowItemHint}>Strip overlays from every poster</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                className={styles.actionBtnSecondary}
                onClick={() => {
                  setBulkOpen(true);
                  bulkPreviewMutation.mutate({ sectionId, count: 6 });
                }}
                disabled={configs.length === 0 || bulkPreviewMutation.isPending}
              >
                {bulkPreviewMutation.isPending ? <Spinner size="xs" /> : "Bulk Preview"}
              </button>
              <button
                className={styles.actionBtnPrimary}
                onClick={() => startJobMutation.mutate({ jobId: "overlays" })}
                disabled={startJobMutation.isPending || configs.length === 0}
              >
                Apply Overlays
              </button>
            </div>
          </>
        )}

        <BulkPreviewModal
          open={bulkOpen}
          loading={bulkPreviewMutation.isPending}
          items={bulkItems}
          onClose={() => setBulkOpen(false)}
        />

        {confirmClearOpen && (
          <ConfirmModal
            message={`Remove all ${configs.length} overlay${configs.length === 1 ? "" : "s"} from this section's layout? This won't change posters that have already been applied in Plex.`}
            title="Clear overlay layout?"
            confirmLabel="Clear"
            danger
            onConfirm={() => clearConfigsMutation.mutate({ sectionId })}
            onCancel={() => setConfirmClearOpen(false)}
          />
        )}

        <SavePresetModal
          open={savePresetOpen}
          name={presetName}
          description={presetDesc}
          saving={savePresetMutation.isPending}
          onNameChange={setPresetName}
          onDescriptionChange={setPresetDesc}
          onClose={() => setSavePresetOpen(false)}
          onSave={() =>
            savePresetMutation.mutate({ sectionId, name: presetName.trim(), description: presetDesc.trim() })
          }
        />

        <ImportLayoutModal
          open={importOpen}
          text={importText}
          mode={importMode}
          error={importError}
          importing={importSectionMutation.isPending}
          existingCount={configs.length}
          onTextChange={(v) => {
            setImportText(v);
            if (importError) setImportError(null);
          }}
          onModeChange={setImportMode}
          onPickFile={handleImportFile}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      </div>
    </PageShell>
  );
}

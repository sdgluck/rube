import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { trpc } from "#/trpc";
import { useToast } from "#components/Toast";
import { PosterCanvas, type BadgeLayout, type CanvasBadge } from "#lib/PosterCanvas";
import ConfirmModal from "#components/ConfirmModal";
import { PageSkeleton } from "#components/Skeleton";
import Spinner from "#components/Spinner";
import type { OverlayPosition, OverlayType, BadgeStyle, ConditionalRule } from "@tinkerbell/contracts";
import styles from "./Overlays.module.css";

type ColorPreset = NonNullable<BadgeStyle["colorPreset"]>;

const POSITIONS: { id: OverlayPosition; label: string }[] = [
  { id: "top-left", label: "Top Left" },
  { id: "top-center", label: "Top Center" },
  { id: "top-right", label: "Top Right" },
  { id: "middle-left", label: "Middle Left" },
  { id: "middle-center", label: "Middle Center" },
  { id: "middle-right", label: "Middle Right" },
  { id: "bottom-left", label: "Bottom Left" },
  { id: "bottom-center", label: "Bottom Center" },
  { id: "bottom-right", label: "Bottom Right" },
];

interface OverlayChip {
  type: OverlayType;
  label: string;
  group: "Quality" | "Audio" | "Ratings" | "Metadata";
  sample: string;
}

const OVERLAY_CATALOG: OverlayChip[] = [
  { type: "resolution", label: "Resolution", group: "Quality", sample: "4K" },
  { type: "video_codec", label: "Video Codec", group: "Quality", sample: "H.265" },
  { type: "hdr", label: "HDR", group: "Quality", sample: "DV" },
  { type: "audio_codec", label: "Audio Codec", group: "Audio", sample: "Atmos" },
  { type: "audio_channels", label: "Audio Channels", group: "Audio", sample: "5.1" },
  { type: "imdb_rating", label: "IMDb Rating", group: "Ratings", sample: "IMDb 8.5" },
  { type: "rt_rating", label: "RT Rating", group: "Ratings", sample: "RT 95%" },
  { type: "content_rating", label: "Content Rating", group: "Ratings", sample: "PG-13" },
  { type: "edition", label: "Edition", group: "Metadata", sample: "Extended" },
  { type: "studio", label: "Studio", group: "Metadata", sample: "A24" },
  { type: "runtime", label: "Runtime", group: "Metadata", sample: "2h 15m" },
  { type: "show_status", label: "Show Status", group: "Metadata", sample: "Ongoing" },
];

interface ColorPresetDef {
  id: ColorPreset;
  bg: string;
  text: string;
  label: string;
  group: "Standard" | "Brand";
}
const COLOR_PRESETS: ColorPresetDef[] = [
  {
    id: "auto",
    bg: "linear-gradient(to bottom right,#6b7280 50%,#d4a017 50%)",
    text: "#fff",
    label: "Auto",
    group: "Standard",
  },
  { id: "gold", bg: "#D4A017", text: "#fff", label: "Gold", group: "Standard" },
  { id: "blue", bg: "#2563EB", text: "#fff", label: "Blue", group: "Standard" },
  { id: "green", bg: "#16A34A", text: "#fff", label: "Green", group: "Standard" },
  { id: "red", bg: "#DC2626", text: "#fff", label: "Red", group: "Standard" },
  { id: "orange", bg: "#EA580C", text: "#fff", label: "Orange", group: "Standard" },
  { id: "purple", bg: "#7C3AED", text: "#fff", label: "Purple", group: "Standard" },
  { id: "teal", bg: "#0D9488", text: "#fff", label: "Teal", group: "Standard" },
  { id: "dark", bg: "rgba(0,0,0,0.7)", text: "#fff", label: "Dark", group: "Standard" },
  { id: "light", bg: "#F3F4F6", text: "#111", label: "Light", group: "Standard" },
  { id: "gray", bg: "#6B7280", text: "#fff", label: "Gray", group: "Standard" },
  { id: "imdb", bg: "#F5C518", text: "#000", label: "IMDb", group: "Brand" },
  { id: "rt", bg: "#FA320A", text: "#fff", label: "RT", group: "Brand" },
  { id: "plex", bg: "#E5A00D", text: "#1F1F1F", label: "Plex", group: "Brand" },
];

const FONT_SIZE_OPTIONS: { id: NonNullable<BadgeStyle["fontSize"]>; label: string }[] = [
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
  { id: "xl", label: "XL" },
  { id: "xxl", label: "XXL" },
];

const SHAPE_OPTIONS: { id: NonNullable<BadgeStyle["shape"]>; label: string; icon: string }[] = [
  { id: "rounded", label: "Rounded", icon: "▢" },
  { id: "pill", label: "Pill", icon: "▱" },
  { id: "rect", label: "Square", icon: "□" },
  { id: "tag", label: "Tag", icon: "▶" },
];

function getPlaceholderValue(type: string): string {
  return OVERLAY_CATALOG.find((c) => c.type === type)?.sample ?? type;
}

function badgePreviewStyle(
  type: OverlayType,
  value: string,
  style: BadgeStyle | null | undefined,
  options?: { compact?: boolean },
): React.CSSProperties {
  let bg = "#6b7280";
  let text = "#fff";
  // Auto colors mirror server's getBadgeColors.
  if (type === "resolution") {
    if (value === "4K") {
      bg = "#D4A017";
    } else if (value === "1080p") {
      bg = "#2563EB";
    } else if (value === "720p") {
      bg = "#16A34A";
    }
  } else if (type === "imdb_rating") {
    bg = "#F5C518";
    text = "#000";
  } else if (type === "rt_rating") {
    bg = "#FA320A";
  } else if (type === "hdr") {
    bg = "#7C3AED";
  } else if (type === "edition") {
    bg = "#0D9488";
  } else {
    bg = "rgba(0,0,0,0.7)";
  }

  if (style?.colorPreset && style.colorPreset !== "auto" && style.colorPreset !== "custom") {
    const preset = COLOR_PRESETS.find((p) => p.id === style.colorPreset);
    if (preset) {
      bg = preset.bg;
      text = preset.text;
    }
  }
  if (style?.colorPreset === "custom" && style.customBg) {
    bg = style.customBg;
    text = style.customText || "#fff";
  }

  const baseMul =
    style?.fontSize === "sm"
      ? 1.2
      : style?.fontSize === "lg"
        ? 1.875
        : style?.fontSize === "xl"
          ? 2.25
          : style?.fontSize === "xxl"
            ? 3.0
            : 1.5;
  // Catalog chips show inline as sample swatches; the 1.5x server scale is
  // too big for that compact context.
  const sizeMul = options?.compact ? baseMul * 0.6 : baseMul;
  const shape = style?.shape ?? "rounded";
  const radius = shape === "pill" ? "999px" : shape === "rect" ? "0" : "4px";

  return {
    background: bg,
    color: text,
    fontSize: `${0.75 * sizeMul}rem`,
    padding: `${3 * sizeMul}px ${8 * sizeMul}px`,
    borderRadius: radius,
    opacity: style?.opacity ?? 1,
    fontWeight: 700,
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    lineHeight: 1.3,
    ...(shape === "tag"
      ? {
          clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)",
          paddingRight: `${(8 + 8) * sizeMul}px`,
        }
      : {}),
  };
}

export default function Overlays() {
  const toast = useToast();
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
  const importFileRef = useRef<HTMLInputElement | null>(null);
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

  const handleImportFile = useCallback((file: File) => {
    file.text().then((text) => {
      setImportText(text);
      setImportError(null);
    });
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

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h2 className={styles.title}>
            Poster Overlays
            {sections.length > 1 && (
              <select
                className={styles.sectionSelectInline}
                value={sectionId}
                onChange={(e) => setActiveSection(e.target.value)}
              >
                {sections.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.title}
                  </option>
                ))}
              </select>
            )}
          </h2>
        </div>
      </header>

      {sections.length === 0 ? (
        <p>No movie or TV libraries found. Configure your Plex libraries in Settings.</p>
      ) : (
        <>
          <div className={styles.workspace}>
            {/* ─── Left: catalog + presets (separate panels) ────────── */}
            <div className={styles.catalogColumn}>
              <aside className={styles.catalog}>
                <h3 className={styles.paneTitle}>Overlays</h3>
                <div className={styles.panelBody}>
                  {(["Quality", "Audio", "Ratings", "Metadata"] as const).map((group) => (
                    <div key={group} className={styles.catalogGroup}>
                      <div className={styles.catalogGroupLabel}>{group}</div>
                      <div className={styles.chipList}>
                        {OVERLAY_CATALOG.filter((c) => c.group === group).map((chip) => (
                          <div
                            key={chip.type}
                            className={styles.catalogChip}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "new", type: chip.type }));
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                          >
                            <span className={styles.catalogChipLabel}>{chip.label}</span>
                            <span
                              className={styles.catalogChipSample}
                              style={badgePreviewStyle(chip.type, chip.sample, null, { compact: true })}
                            >
                              {chip.sample}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </aside>
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
                      Click a placed overlay to customize its label, color, size, shape, opacity, and visibility rules.
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
                className={styles.actionBtnSecondary}
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

      {/* ─── Bulk preview modal ─────────────────────────────────── */}
      {bulkOpen && (
        <div className={styles.modalBackdrop} onClick={() => setBulkOpen(false)}>
          <div className={styles.modalLg} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Bulk Preview</h3>
              <button className={styles.modalClose} onClick={() => setBulkOpen(false)}>
                ×
              </button>
            </div>
            {bulkPreviewMutation.isPending ? (
              <p className={styles.modalHint}>Rendering 6 random posters…</p>
            ) : (
              <div className={styles.bulkGrid}>
                {bulkItems.map((it) => (
                  <div key={it.ratingKey} className={styles.bulkCell}>
                    <img src={`data:image/jpeg;base64,${it.image}`} alt={it.title} />
                    <span>{it.title}</span>
                  </div>
                ))}
              </div>
            )}
            <p className={styles.modalHint}>Preview only — no changes have been made in Plex.</p>
          </div>
        </div>
      )}

      {confirmClearOpen && (
        <ConfirmModal
          message={`Remove all ${configs.length} overlay${configs.length === 1 ? "" : "s"} from this section's layout? This won't change posters that have already been applied in Plex.`}
          confirmLabel="Clear"
          danger
          onConfirm={() => clearConfigsMutation.mutate({ sectionId })}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}

      {/* ─── Save preset modal ──────────────────────────────────── */}
      {savePresetOpen && (
        <div className={styles.modalBackdrop} onClick={() => setSavePresetOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Save preset</h3>
              <button className={styles.modalClose} onClick={() => setSavePresetOpen(false)}>
                ×
              </button>
            </div>
            <label className={styles.fieldLabel}>Name</label>
            <input
              className={styles.input}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="My overlay style"
              autoFocus
            />
            <label className={styles.fieldLabel}>Description</label>
            <input
              className={styles.input}
              value={presetDesc}
              onChange={(e) => setPresetDesc(e.target.value)}
              placeholder="Optional"
            />
            <div className={styles.modalActions}>
              <button className={styles.smallBtn} onClick={() => setSavePresetOpen(false)}>
                Cancel
              </button>
              <button
                className={styles.actionBtnPrimary}
                disabled={!presetName.trim() || savePresetMutation.isPending}
                onClick={() =>
                  savePresetMutation.mutate({ sectionId, name: presetName.trim(), description: presetDesc.trim() })
                }
              >
                {savePresetMutation.isPending ? (
                  <>
                    <Spinner size="xs" /> Saving…
                  </>
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Import layout modal ────────────────────────────────── */}
      {importOpen && (
        <div className={styles.modalBackdrop} onClick={() => setImportOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Import layout</h3>
              <button className={styles.modalClose} onClick={() => setImportOpen(false)}>
                ×
              </button>
            </div>
            <p className={styles.modalHint} style={{ textAlign: "left" }}>
              Choose a JSON file exported from this page, or paste its contents.
            </p>
            <div>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFile(f);
                  e.target.value = "";
                }}
              />
              <button className={styles.smallBtn} onClick={() => importFileRef.current?.click()}>
                Choose file…
              </button>
            </div>
            <textarea
              className={styles.input}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                if (importError) setImportError(null);
              }}
              placeholder='{"version":1,"configs":[…]}'
              rows={8}
              style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.78rem", resize: "vertical" }}
            />
            <div className={styles.checkRow}>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                />
                Replace ({configs.length} existing will be removed)
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === "append"}
                  onChange={() => setImportMode("append")}
                />
                Append to existing
              </label>
            </div>
            {importError && (
              <p className={styles.fieldHint} style={{ color: "#dc3545" }}>
                {importError}
              </p>
            )}
            <div className={styles.modalActions}>
              <button className={styles.smallBtn} onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button
                className={styles.actionBtnPrimary}
                disabled={!importText.trim() || importSectionMutation.isPending}
                onClick={handleImport}
              >
                {importSectionMutation.isPending ? (
                  <>
                    <Spinner size="xs" /> Importing…
                  </>
                ) : (
                  "Import"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*                          Inspector                              */
/* ─────────────────────────────────────────────────────────────── */

interface InspectorProps {
  config: {
    id: number;
    overlayType: OverlayType;
    position: string;
    style: BadgeStyle | null;
    rule: ConditionalRule | null;
  };
  onPatchStyle: (patch: Partial<BadgeStyle>) => void;
  onPatchRule: (patch: Partial<ConditionalRule>) => void;
  onResetStyle: () => void;
  onResetRule: () => void;
  onRemove: () => void;
  onClose: () => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
}

function Inspector({
  config,
  onPatchStyle,
  onPatchRule,
  onResetStyle,
  onResetRule,
  onRemove,
  onClose,
  onMoveUp,
  onMoveDown,
}: InspectorProps) {
  const overlay = OVERLAY_CATALOG.find((c) => c.type === config.overlayType);
  const style = config.style ?? {};
  const rule = config.rule ?? {};
  const showRatingRule = config.overlayType === "imdb_rating" || config.overlayType === "rt_rating";
  const showResolutionRule = config.overlayType === "resolution";

  // Local label state so typing is responsive (server commit on blur / debounce).
  const [labelDraft, setLabelDraft] = useState<string>(style.customLabel ?? "");
  const lastConfigId = useRef(config.id);
  useEffect(() => {
    if (lastConfigId.current !== config.id) {
      setLabelDraft(style.customLabel ?? "");
      lastConfigId.current = config.id;
    }
  }, [config.id, style.customLabel]);

  return (
    <div className={styles.inspectorBody}>
      <div className={styles.inspectorHeader}>
        <h3 className={styles.paneTitle}>{overlay?.label ?? config.overlayType}</h3>
        <div className={styles.inspectorHeaderActions}>
          <button
            className={styles.iconBtn}
            onClick={() => onMoveUp?.()}
            disabled={!onMoveUp}
            title="Move up in stack"
            aria-label="Move up"
          >
            ▲
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => onMoveDown?.()}
            disabled={!onMoveDown}
            title="Move down in stack"
            aria-label="Move down"
          >
            ▼
          </button>
          <button className={styles.iconBtn} onClick={onClose} title="Close">
            ×
          </button>
        </div>
      </div>

      <Section title="Label">
        <input
          className={styles.input}
          placeholder={overlay?.sample ?? ""}
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => {
            const next = labelDraft.trim();
            if ((next || undefined) !== (style.customLabel || undefined)) {
              onPatchStyle({ customLabel: next || undefined });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          maxLength={40}
        />
        <p className={styles.fieldHint}>Override the auto-resolved value (leave empty to use the actual data)</p>
      </Section>

      <Section title="Font size">
        <div className={styles.segmented}>
          {FONT_SIZE_OPTIONS.map((s) => (
            <button
              key={s.id}
              className={`${styles.segmentedBtn} ${(style.fontSize ?? "md") === s.id ? styles.segmentedActive : ""}`}
              onClick={() => onPatchStyle({ fontSize: s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Shape">
        <div className={styles.segmented}>
          {SHAPE_OPTIONS.map((s) => (
            <button
              key={s.id}
              className={`${styles.segmentedBtn} ${(style.shape ?? "rounded") === s.id ? styles.segmentedActive : ""}`}
              onClick={() => onPatchStyle({ shape: s.id })}
              title={s.label}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Color">
        <div className={styles.colorGrid}>
          {COLOR_PRESETS.filter((c) => c.group === "Standard").map((c) => (
            <button
              key={c.id}
              className={`${styles.colorSwatch} ${c.id === "auto" ? styles.colorSwatchAuto : ""} ${(style.colorPreset ?? "auto") === c.id ? styles.colorSwatchActive : ""}`}
              style={c.id === "auto" ? { color: c.text } : { background: c.bg, color: c.text }}
              onClick={() => onPatchStyle({ colorPreset: c.id, customBg: undefined, customText: undefined })}
              title={c.label}
            >
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <div className={styles.colorBrandLabel}>Brand</div>
        <div className={styles.colorGrid}>
          {COLOR_PRESETS.filter((c) => c.group === "Brand").map((c) => (
            <button
              key={c.id}
              className={`${styles.colorSwatch} ${c.id === "auto" ? styles.colorSwatchAuto : ""} ${(style.colorPreset ?? "auto") === c.id ? styles.colorSwatchActive : ""}`}
              style={c.id === "auto" ? { color: c.text } : { background: c.bg, color: c.text }}
              onClick={() => onPatchStyle({ colorPreset: c.id, customBg: undefined, customText: undefined })}
              title={c.label}
            >
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <div className={styles.customColorRow}>
          <label className={styles.fieldHint}>Custom hex</label>
          <input
            type="color"
            value={style.customBg ?? "#4a6cf7"}
            onChange={(e) => onPatchStyle({ colorPreset: "custom", customBg: e.target.value })}
          />
          <input
            type="color"
            title="Text color"
            value={style.customText ?? "#ffffff"}
            onChange={(e) => onPatchStyle({ colorPreset: "custom", customText: e.target.value })}
          />
        </div>
      </Section>

      <Section title={`Opacity — ${(style.opacity ?? 1).toFixed(2)}`}>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={style.opacity ?? 1}
          onChange={(e) => onPatchStyle({ opacity: parseFloat(e.target.value) })}
          className={styles.slider}
        />
      </Section>

      {(showRatingRule || showResolutionRule) && (
        <Section title="Visibility rule">
          {showRatingRule && config.overlayType === "imdb_rating" && (
            <div className={styles.ruleRow}>
              <label>Only show if IMDb ≥</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={10}
                value={rule.minImdb ?? ""}
                onChange={(e) => onPatchRule({ minImdb: e.target.value ? parseFloat(e.target.value) : undefined })}
                className={styles.numberInput}
                placeholder="—"
              />
            </div>
          )}
          {showRatingRule && config.overlayType === "rt_rating" && (
            <div className={styles.ruleRow}>
              <label>Only show if RT ≥</label>
              <input
                type="number"
                step={1}
                min={0}
                max={100}
                value={rule.minRt ?? ""}
                onChange={(e) => onPatchRule({ minRt: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                className={styles.numberInput}
                placeholder="—"
              />
              <span>%</span>
            </div>
          )}
          {showResolutionRule && (
            <div className={styles.checkRow}>
              <span className={styles.fieldHint}>Only show for:</span>
              {["4K", "1080p", "720p", "480p"].map((res) => {
                const enabled = !rule.onlyResolutions || rule.onlyResolutions.includes(res);
                return (
                  <label key={res} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => {
                        const cur = rule.onlyResolutions ?? ["4K", "1080p", "720p", "480p"];
                        const next = e.target.checked ? [...new Set([...cur, res])] : cur.filter((r) => r !== res);
                        onPatchRule({ onlyResolutions: next.length === 4 ? undefined : next });
                      }}
                    />
                    {res}
                  </label>
                );
              })}
            </div>
          )}
          <label className={styles.checkLabel}>
            <input
              type="checkbox"
              checked={rule.hideIfMissing ?? false}
              onChange={(e) => onPatchRule({ hideIfMissing: e.target.checked || undefined })}
            />
            Hide if the value can't be resolved
          </label>
          {(rule.minImdb !== undefined ||
            rule.minRt !== undefined ||
            rule.onlyResolutions !== undefined ||
            rule.hideIfMissing) && (
            <button className={styles.linkBtn} onClick={onResetRule}>
              Clear rule
            </button>
          )}
        </Section>
      )}

      <div className={styles.inspectorFooter}>
        <button className={styles.linkBtn} onClick={onResetStyle}>
          Reset style
        </button>
        <button className={styles.dangerBtn} onClick={onRemove}>
          Remove overlay
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */
/*                          PresetList                             */
/* ─────────────────────────────────────────────────────────────── */

interface PresetListProps {
  presets: Array<{ id: string; name: string; description: string; builtIn: boolean }>;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveCurrent: () => void;
  canSave: boolean;
}

function PresetList({ presets, onApply, onDelete, onSaveCurrent, canSave }: PresetListProps) {
  const builtIn = presets.filter((p) => p.builtIn);
  const userPresets = presets.filter((p) => !p.builtIn);

  return (
    <div className={styles.presetList}>
      {builtIn.length > 0 && <div className={styles.presetGroupLabel}>Built-in</div>}
      {builtIn.map((p) => (
        <button key={p.id} className={styles.presetItem} onClick={() => onApply(p.id)}>
          <span className={styles.presetItemName}>{p.name}</span>
          <span className={styles.presetItemDesc}>{p.description}</span>
        </button>
      ))}
      {userPresets.length > 0 && <div className={styles.presetGroupLabel}>Yours</div>}
      {userPresets.map((p) => (
        <div key={p.id} className={styles.presetRow}>
          <button className={styles.presetItem} onClick={() => onApply(p.id)}>
            <span className={styles.presetItemName}>{p.name}</span>
            <span className={styles.presetItemDesc}>{p.description}</span>
          </button>
          <button className={styles.iconBtn} onClick={() => onDelete(p.id)} title="Delete preset">
            ×
          </button>
        </div>
      ))}
      <button
        className={styles.presetSaveBtn}
        onClick={onSaveCurrent}
        disabled={!canSave}
        title={canSave ? "Save the current section's overlays as a preset" : "Add at least one overlay first"}
      >
        + Save current as preset…
      </button>
    </div>
  );
}

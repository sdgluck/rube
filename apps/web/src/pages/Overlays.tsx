import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { trpc } from "../trpc";
import { useToast } from "../Toast";
import { PosterCanvas, type BadgeLayout, type CanvasBadge } from "../lib/PosterCanvas";
import ConfirmModal from "../ConfirmModal";
import type { OverlayPosition, OverlayType, BadgeStyle, ConditionalRule } from "@server/domains/overlays.ts";
import styles from "./Overlays.module.css";

type ColorPreset = NonNullable<BadgeStyle["colorPreset"]>;

const POSITIONS: { id: OverlayPosition; label: string }[] = [
  { id: "top-left", label: "Top Left" },
  { id: "top-center", label: "Top Center" },
  { id: "top-right", label: "Top Right" },
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
];

const COLOR_PRESETS: { id: ColorPreset; bg: string; text: string; label: string }[] = [
  { id: "auto", bg: "linear-gradient(135deg,#6b7280 50%,#d4a017 50%)", text: "#fff", label: "Auto" },
  { id: "gold", bg: "#D4A017", text: "#fff", label: "Gold" },
  { id: "blue", bg: "#2563EB", text: "#fff", label: "Blue" },
  { id: "green", bg: "#16A34A", text: "#fff", label: "Green" },
  { id: "red", bg: "#DC2626", text: "#fff", label: "Red" },
  { id: "orange", bg: "#EA580C", text: "#fff", label: "Orange" },
  { id: "purple", bg: "#7C3AED", text: "#fff", label: "Purple" },
  { id: "teal", bg: "#0D9488", text: "#fff", label: "Teal" },
  { id: "imdb", bg: "#F5C518", text: "#000", label: "IMDb" },
  { id: "rt", bg: "#FA320A", text: "#fff", label: "RT" },
  { id: "plex", bg: "#E5A00D", text: "#1F1F1F", label: "Plex" },
  { id: "dark", bg: "rgba(0,0,0,0.7)", text: "#fff", label: "Dark" },
  { id: "light", bg: "#F3F4F6", text: "#111", label: "Light" },
  { id: "gray", bg: "#6B7280", text: "#fff", label: "Gray" },
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

  const sizeMul =
    style?.fontSize === "sm"
      ? 0.8
      : style?.fontSize === "lg"
        ? 1.25
        : style?.fontSize === "xl"
          ? 1.5
          : style?.fontSize === "xxl"
            ? 2.0
            : 1;
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
  const [bulkItems, setBulkItems] = useState<Array<{ title: string; ratingKey: string; image: string }>>([]);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetDesc, setPresetDesc] = useState("");
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

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

  // Track the rendered poster frame's size so hit boxes scale with it.
  useEffect(() => {
    const el = posterFrameRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setFrameSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keyboard: Delete to remove selected, arrows to nudge between zones.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (selectedConfigId == null) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeConfigMutation.mutate({ id: selectedConfigId });
        setSelectedConfigId(null);
      } else if (e.key.startsWith("Arrow")) {
        const cur = configs.find((c) => c.id === selectedConfigId);
        if (!cur) return;
        const idx = POSITIONS.findIndex((p) => p.id === cur.position);
        let next = idx;
        if (e.key === "ArrowLeft") next = Math.max(0, idx - 1);
        else if (e.key === "ArrowRight") next = Math.min(POSITIONS.length - 1, idx + 1);
        else if (e.key === "ArrowUp") next = idx >= 3 ? idx - 3 : idx;
        else if (e.key === "ArrowDown") next = idx < 3 ? idx + 3 : idx;
        if (next !== idx) {
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

  if (sectionsQuery.isLoading) return <p>Loading...</p>;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Poster Overlays</h2>
          <p className={styles.subtitle}>
            Drag overlays onto poster zones. Click a placed overlay to customize its appearance and visibility rules.
          </p>
        </div>
        {sections.length > 1 && (
          <select className={styles.sectionSelect} value={sectionId} onChange={(e) => setActiveSection(e.target.value)}>
            {sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        )}
      </header>

      {sections.length === 0 ? (
        <p>No movie or TV libraries found. Configure your Plex libraries in Settings.</p>
      ) : (
        <>
          <div className={styles.workspace}>
            {/* ─── Left: catalog ───────────────────────────────────── */}
            <aside className={styles.catalog}>
              <CollapsibleSection title="Overlays" defaultOpen storageKey="ovl.left.overlays">
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
                            style={badgePreviewStyle(chip.type, chip.sample, null)}
                          >
                            {chip.sample}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CollapsibleSection>

              <CollapsibleSection title="Presets" defaultOpen={false} storageKey="ovl.left.presets">
                <PresetList
                  presets={presetsQuery.data ?? []}
                  onApply={(id) => applyPresetMutation.mutate({ sectionId, presetId: id })}
                  onDelete={(id) => deletePresetMutation.mutate({ id })}
                  onSaveCurrent={() => setSavePresetOpen(true)}
                  canSave={configs.length > 0}
                />
              </CollapsibleSection>
            </aside>

            {/* ─── Center: poster canvas ───────────────────────────── */}
            <div className={styles.canvas}>
              <div className={styles.canvasHeader}>
                <span className={styles.canvasTitle}>
                  {sampleQuery.data
                    ? `${sampleQuery.data.title}${sampleQuery.data.year ? ` (${sampleQuery.data.year})` : ""}`
                    : "Loading..."}
                </span>
                <div className={styles.canvasActions}>
                  <button className={styles.smallBtn} onClick={handleShuffle} disabled={sampleQuery.isFetching}>
                    Shuffle
                  </button>
                  <button
                    className={styles.smallBtn}
                    onMouseDown={() => setHidingBadges(true)}
                    onMouseUp={() => setHidingBadges(false)}
                    onMouseLeave={() => setHidingBadges(false)}
                    onTouchStart={() => setHidingBadges(true)}
                    onTouchEnd={() => setHidingBadges(false)}
                    disabled={canvasBadges.length === 0}
                    title="Hold to see the original poster"
                  >
                    Original
                  </button>
                  <button
                    className={styles.smallBtn}
                    onClick={() => {
                      setBulkOpen(true);
                      bulkPreviewMutation.mutate({ sectionId, count: 6 });
                    }}
                    disabled={configs.length === 0 || bulkPreviewMutation.isPending}
                  >
                    {bulkPreviewMutation.isPending ? "Loading..." : "Bulk Preview"}
                  </button>
                </div>
              </div>

              <div
                ref={posterFrameRef}
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

                {/* Drop targets at each corner — accept drops; visible only when empty */}
                {POSITIONS.map((pos) => {
                  const stack = configsByPosition.get(pos.id) ?? [];
                  const isOver = dragOverPosition === pos.id;

                  return (
                    <div
                      key={pos.id}
                      className={`${styles.dropZone} ${styles[`pos_${pos.id.replace("-", "_")}`]} ${isOver ? styles.dropZoneOver : ""} ${stack.length === 0 ? styles.dropZoneEmpty : styles.dropZoneOccupied}`}
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
                      {stack.length === 0 && <span className={styles.dropZonePlaceholder}>{pos.label}</span>}
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

            {/* ─── Right: inspector ────────────────────────────────── */}
            <aside className={styles.inspector}>
              {selected ? (
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
                />
              ) : (
                <div className={styles.inspectorEmpty}>
                  <h3 className={styles.paneTitle}>Inspector</h3>
                  <p className={styles.inspectorEmptyText}>
                    Click a placed overlay to customize its label, color, font size, shape, opacity, and conditional
                    visibility rules.
                  </p>
                  <div className={styles.statusCard}>
                    <div className={styles.statusCardLabel}>Library status</div>
                    <div className={styles.statusCardValue}>
                      {statusQuery.data
                        ? `${statusQuery.data.count} item${statusQuery.data.count === 1 ? "" : "s"} overlaid`
                        : "Loading..."}
                    </div>
                  </div>
                  {configs.length === 0 && (presetsQuery.data?.length ?? 0) > 0 && (
                    <div className={styles.startCard}>
                      <div className={styles.startCardLabel}>Start with a preset</div>
                      <div className={styles.presetQuickList}>
                        {presetsQuery
                          .data!.filter((p) => p.builtIn)
                          .slice(0, 4)
                          .map((p) => (
                            <button
                              key={p.id}
                              className={styles.presetQuickItem}
                              onClick={() => applyPresetMutation.mutate({ sectionId, presetId: p.id })}
                            >
                              <span className={styles.presetQuickName}>{p.name}</span>
                              <span className={styles.presetQuickDesc}>{p.description}</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>

          {/* ─── Sticky bottom action bar ─────────────────────────── */}
          <div className={styles.actionBar}>
            <span className={styles.actionBarStatus}>
              {statusQuery.data
                ? `${statusQuery.data.count} item${statusQuery.data.count === 1 ? "" : "s"} have overlays applied`
                : "Loading..."}
            </span>
            <button
              className={styles.smallBtn}
              onClick={() => setConfirmClearOpen(true)}
              disabled={configs.length === 0 || clearConfigsMutation.isPending}
              title="Remove every overlay from this section's layout (does not change Plex)"
            >
              Clear Layout
            </button>
            <button
              className={styles.actionBtnPrimary}
              onClick={() => startJobMutation.mutate({ jobId: "overlays" })}
              disabled={startJobMutation.isPending || configs.length === 0}
            >
              Apply Overlays
            </button>
            <button
              className={styles.actionBtnDanger}
              onClick={() => startJobMutation.mutate({ jobId: "overlays-remove" })}
              disabled={startJobMutation.isPending || (statusQuery.data?.count || 0) === 0}
            >
              Remove All
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
                {savePresetMutation.isPending ? "Saving..." : "Save"}
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
}

function Inspector({
  config,
  onPatchStyle,
  onPatchRule,
  onResetStyle,
  onResetRule,
  onRemove,
  onClose,
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

  const previewValue = labelDraft || overlay?.sample || "Sample";

  return (
    <div className={styles.inspectorBody}>
      <div className={styles.inspectorHeader}>
        <h3 className={styles.paneTitle}>{overlay?.label ?? config.overlayType}</h3>
        <button className={styles.iconBtn} onClick={onClose} title="Close">
          ×
        </button>
      </div>

      <div className={styles.previewBox}>
        <span style={badgePreviewStyle(config.overlayType, previewValue, style)}>{previewValue}</span>
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
          {COLOR_PRESETS.map((c) => (
            <button
              key={c.id}
              className={`${styles.colorSwatch} ${(style.colorPreset ?? "auto") === c.id ? styles.colorSwatchActive : ""}`}
              style={{ background: c.bg, color: c.text }}
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
/*                     CollapsibleSection                          */
/* ─────────────────────────────────────────────────────────────── */

function CollapsibleSection({
  title,
  defaultOpen,
  storageKey,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  storageKey?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored === "1") return true;
      if (stored === "0") return false;
    }
    return defaultOpen;
  });

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (storageKey) localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className={styles.collapsible}>
      <button className={styles.collapsibleHeader} onClick={toggle} aria-expanded={open}>
        <span className={styles.collapsibleChevron}>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
      </button>
      {open && <div className={styles.collapsibleBody}>{children}</div>}
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

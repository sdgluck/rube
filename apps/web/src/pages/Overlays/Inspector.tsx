import { useEffect, useRef, useState } from "react";
import { EMPTY } from "#/format";
import type { BadgeStyle, ConditionalRule, OverlayType } from "@rube/contracts";
import styles from "../Overlays.module.css";
import { COLOR_PRESETS, FONT_SIZE_OPTIONS, OVERLAY_CATALOG, SHAPE_OPTIONS } from "./constants";

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

export function Inspector({
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
          <button className={styles.iconBtn} onClick={onClose} title="Close" aria-label="Close inspector">
            ×
          </button>
        </div>
      </div>

      <Section title="Label">
        <input
          className={styles.fieldInput}
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
        <p className={styles.fieldHint}>Blank shows each item's own value.</p>
      </Section>

      <Section title="Font size">
        <div className={styles.modeSwitch}>
          {FONT_SIZE_OPTIONS.map((s) => (
            <button
              key={s.id}
              className={`${styles.modeSwitchBtn} ${(style.fontSize ?? "md") === s.id ? styles.modeSwitchActive : ""}`}
              onClick={() => onPatchStyle({ fontSize: s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Shape">
        <div className={styles.modeSwitch}>
          {SHAPE_OPTIONS.map((s) => (
            <button
              key={s.id}
              className={`${styles.modeSwitchBtn} ${(style.shape ?? "rounded") === s.id ? styles.modeSwitchActive : ""}`}
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
                placeholder={EMPTY}
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
                placeholder={EMPTY}
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

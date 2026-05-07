import type { BadgeStyle, OverlayType } from "@tinkerbell/contracts";
import { COLOR_PRESETS, OVERLAY_CATALOG } from "./constants";

export function getPlaceholderValue(type: string): string {
  return OVERLAY_CATALOG.find((c) => c.type === type)?.sample ?? type;
}

export function badgePreviewStyle(
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

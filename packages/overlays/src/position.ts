import type { OverlayPosition } from "./schemas.ts";

export function calculatePosition(
  position: OverlayPosition,
  imgW: number,
  imgH: number,
  badgeW: number,
  badgeH: number,
  scale: number,
): { left: number; top: number } {
  const margin = Math.round(10 * scale);
  switch (position) {
    case "top-left":
      return { left: margin, top: margin };
    case "top-center":
      return { left: Math.round((imgW - badgeW) / 2), top: margin };
    case "top-right":
      return { left: imgW - badgeW - margin, top: margin };
    case "middle-left":
      return { left: margin, top: Math.round((imgH - badgeH) / 2) };
    case "middle-center":
      return { left: Math.round((imgW - badgeW) / 2), top: Math.round((imgH - badgeH) / 2) };
    case "middle-right":
      return { left: imgW - badgeW - margin, top: Math.round((imgH - badgeH) / 2) };
    case "bottom-left":
      return { left: margin, top: imgH - badgeH - margin };
    case "bottom-center":
      return { left: Math.round((imgW - badgeW) / 2), top: imgH - badgeH - margin };
    case "bottom-right":
      return { left: imgW - badgeW - margin, top: imgH - badgeH - margin };
  }
}

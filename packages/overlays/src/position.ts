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
    case "bottom-left":
      return { left: margin, top: imgH - badgeH - margin };
    case "bottom-center":
      return { left: Math.round((imgW - badgeW) / 2), top: imgH - badgeH - margin };
    case "bottom-right":
      return { left: imgW - badgeW - margin, top: imgH - badgeH - margin };
  }
}

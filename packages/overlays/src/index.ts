export {
  overlayPositionSchema,
  overlayTypeSchema,
  OVERLAY_POSITIONS,
  OVERLAY_TYPES,
  type OverlayPosition,
  type OverlayType,
} from "./schemas.ts";
export { resolveOverlayValue, type MediaInfo, type Ratings } from "./resolve.ts";
export { getBadgeColors, createBadgeSvg, escapeXml, type BadgeColors } from "./badge.ts";
export { calculatePosition } from "./position.ts";
export { compositeOverlays, buildCompositeSharp, type Badge } from "./composite.ts";

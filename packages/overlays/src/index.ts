export {
  overlayPositionSchema,
  overlayTypeSchema,
  OVERLAY_POSITIONS,
  OVERLAY_TYPES,
  badgeStyleSchema,
  conditionalRuleSchema,
  fontSizeSchema,
  badgeShapeSchema,
  colorPresetSchema,
  FONT_SIZE_SCALE,
  type OverlayPosition,
  type OverlayType,
  type BadgeStyle,
  type ConditionalRule,
  type FontSize,
  type BadgeShape,
  type ColorPreset,
} from "./schemas.ts";
export { resolveOverlayValue, type MediaInfo, type Ratings } from "./resolve.ts";
export {
  getBadgeColors,
  resolveBadgeColors,
  createBadgeSvg,
  createStyledBadgeSvg,
  escapeXml,
  type BadgeColors,
  type StyledBadgeSvg,
} from "./badge.ts";
export { fitText, loadBundledFont, measureText, textPathData, wrapText, type FittedText } from "./text.ts";
export { calculatePosition } from "./position.ts";
export { compositeOverlays, buildCompositeSharp, type Badge } from "./composite.ts";

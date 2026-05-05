// Re-exports of types that cross the apps boundary (web ↔ server).
// Web should never import directly from server-side packages — only from here
// or from @tinkerbell/trpc (for AppRouter).

export type {
  Badge,
  BadgeShape,
  BadgeStyle,
  ColorPreset,
  ConditionalRule,
  FontSize,
  MediaInfo,
  OverlayPosition,
  OverlayType,
  Ratings,
} from "@tinkerbell/overlays";

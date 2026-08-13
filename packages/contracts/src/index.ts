// Re-exports of types that cross the apps boundary (web ↔ server).
// Web should never import directly from server-side packages — only from here
// or from @tinkerbell/trpc (for AppRouter).

/**
 * Bounds for the generate job's `ruleConcurrency` setting. They live here
 * because both sides need them and neither owns them: the schema in
 * `@tinkerbell/core` enforces the max, the job applies the default, and the
 * admin UI renders the input — and web can't import either of those.
 */
export const RULE_CONCURRENCY_DEFAULT = 3;
export const RULE_CONCURRENCY_MAX = 8;

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

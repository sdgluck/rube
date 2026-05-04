import { z } from "zod";

export const overlayPositionSchema = z.enum([
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);
export type OverlayPosition = z.infer<typeof overlayPositionSchema>;
export const OVERLAY_POSITIONS = overlayPositionSchema.options;

export const overlayTypeSchema = z.enum([
  "resolution",
  "video_codec",
  "audio_codec",
  "content_rating",
  "imdb_rating",
  "rt_rating",
  "hdr",
  "audio_channels",
  "edition",
  "studio",
  "runtime",
  "show_status",
]);
export type OverlayType = z.infer<typeof overlayTypeSchema>;
export const OVERLAY_TYPES = overlayTypeSchema.options;

export const fontSizeSchema = z.enum(["sm", "md", "lg", "xl", "xxl"]);
export type FontSize = z.infer<typeof fontSizeSchema>;

export const badgeShapeSchema = z.enum(["pill", "rounded", "rect", "tag"]);
export type BadgeShape = z.infer<typeof badgeShapeSchema>;

export const colorPresetSchema = z.enum([
  "auto",
  "gold",
  "blue",
  "green",
  "gray",
  "imdb",
  "rt",
  "purple",
  "teal",
  "dark",
  "light",
  "plex",
  "red",
  "orange",
  "custom",
]);
export type ColorPreset = z.infer<typeof colorPresetSchema>;

export const badgeStyleSchema = z
  .object({
    customLabel: z.string().max(40).optional(),
    fontSize: fontSizeSchema.optional(),
    colorPreset: colorPresetSchema.optional(),
    customBg: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    customText: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    shape: badgeShapeSchema.optional(),
    opacity: z.number().min(0.2).max(1).optional(),
    showIcon: z.boolean().optional(),
  })
  .strict();
export type BadgeStyle = z.infer<typeof badgeStyleSchema>;

export const conditionalRuleSchema = z
  .object({
    minImdb: z.number().min(0).max(10).optional(),
    minRt: z.number().min(0).max(100).optional(),
    onlyResolutions: z.array(z.string()).optional(), // e.g. ["4K","1080p"]
    onlyHdr: z.boolean().optional(), // only show if HDR present
    hideIfMissing: z.boolean().optional(), // skip badge entirely if value resolves null
  })
  .strict();
export type ConditionalRule = z.infer<typeof conditionalRuleSchema>;

export const FONT_SIZE_SCALE: Record<FontSize, number> = {
  sm: 1.2,
  md: 1.5,
  lg: 1.875,
  xl: 2.25,
  xxl: 3.0,
};

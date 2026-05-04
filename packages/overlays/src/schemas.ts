import { z } from "zod";

export const overlayPositionSchema = z.enum([
  "top-left",
  "top-center",
  "top-right",
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
]);
export type OverlayType = z.infer<typeof overlayTypeSchema>;
export const OVERLAY_TYPES = overlayTypeSchema.options;

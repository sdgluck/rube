import type { BadgeStyle, OverlayPosition, OverlayType } from "@rube/contracts";

export type ColorPreset = NonNullable<BadgeStyle["colorPreset"]>;

export const POSITIONS: { id: OverlayPosition; label: string }[] = [
  { id: "top-left", label: "Top Left" },
  { id: "top-center", label: "Top Center" },
  { id: "top-right", label: "Top Right" },
  { id: "middle-left", label: "Middle Left" },
  { id: "middle-center", label: "Middle Center" },
  { id: "middle-right", label: "Middle Right" },
  { id: "bottom-left", label: "Bottom Left" },
  { id: "bottom-center", label: "Bottom Center" },
  { id: "bottom-right", label: "Bottom Right" },
];

export interface OverlayChip {
  type: OverlayType;
  label: string;
  group: "Quality" | "Audio" | "Ratings" | "Metadata";
  sample: string;
}

export const OVERLAY_CATALOG: OverlayChip[] = [
  { type: "resolution", label: "Resolution", group: "Quality", sample: "4K" },
  { type: "video_codec", label: "Video Codec", group: "Quality", sample: "H.265" },
  { type: "hdr", label: "HDR", group: "Quality", sample: "DV" },
  { type: "audio_codec", label: "Audio Codec", group: "Audio", sample: "Atmos" },
  { type: "audio_channels", label: "Audio Channels", group: "Audio", sample: "5.1" },
  { type: "imdb_rating", label: "IMDb Rating", group: "Ratings", sample: "IMDb 8.5" },
  { type: "rt_rating", label: "RT Rating", group: "Ratings", sample: "RT 95%" },
  { type: "content_rating", label: "Content Rating", group: "Ratings", sample: "PG-13" },
  { type: "edition", label: "Edition", group: "Metadata", sample: "Extended" },
  { type: "studio", label: "Studio", group: "Metadata", sample: "A24" },
  { type: "runtime", label: "Runtime", group: "Metadata", sample: "2h 15m" },
  { type: "show_status", label: "Show Status", group: "Metadata", sample: "Ongoing" },
];

export interface ColorPresetDef {
  id: ColorPreset;
  bg: string;
  text: string;
  label: string;
  group: "Standard" | "Brand";
}

export const COLOR_PRESETS: ColorPresetDef[] = [
  {
    id: "auto",
    bg: "linear-gradient(to bottom right,#6b7280 50%,#d4a017 50%)",
    text: "#fff",
    label: "Auto",
    group: "Standard",
  },
  { id: "gold", bg: "#D4A017", text: "#fff", label: "Gold", group: "Standard" },
  { id: "blue", bg: "#2563EB", text: "#fff", label: "Blue", group: "Standard" },
  { id: "green", bg: "#16A34A", text: "#fff", label: "Green", group: "Standard" },
  { id: "red", bg: "#DC2626", text: "#fff", label: "Red", group: "Standard" },
  { id: "orange", bg: "#EA580C", text: "#fff", label: "Orange", group: "Standard" },
  { id: "purple", bg: "#7C3AED", text: "#fff", label: "Purple", group: "Standard" },
  { id: "teal", bg: "#0D9488", text: "#fff", label: "Teal", group: "Standard" },
  { id: "dark", bg: "rgba(0,0,0,0.7)", text: "#fff", label: "Dark", group: "Standard" },
  { id: "light", bg: "#F3F4F6", text: "#111", label: "Light", group: "Standard" },
  { id: "gray", bg: "#6B7280", text: "#fff", label: "Gray", group: "Standard" },
  { id: "imdb", bg: "#F5C518", text: "#000", label: "IMDb", group: "Brand" },
  { id: "rt", bg: "#FA320A", text: "#fff", label: "RT", group: "Brand" },
  { id: "plex", bg: "#E5A00D", text: "#1F1F1F", label: "Plex", group: "Brand" },
];

export const FONT_SIZE_OPTIONS: { id: NonNullable<BadgeStyle["fontSize"]>; label: string }[] = [
  { id: "sm", label: "S" },
  { id: "md", label: "M" },
  { id: "lg", label: "L" },
  { id: "xl", label: "XL" },
  { id: "xxl", label: "XXL" },
];

export const SHAPE_OPTIONS: { id: NonNullable<BadgeStyle["shape"]>; label: string; icon: string }[] = [
  { id: "rounded", label: "Rounded", icon: "▢" },
  { id: "pill", label: "Pill", icon: "▱" },
  { id: "rect", label: "Square", icon: "□" },
  { id: "tag", label: "Tag", icon: "▶" },
];

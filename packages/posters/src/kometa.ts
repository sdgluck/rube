import { z } from "zod";

const DEFAULT_IMAGES = "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master";

const FLAT_KINDS = [
  "studio",
  "genre",
  "decade",
  "year",
  "resolution",
  "audio_language",
  "subtitle_language",
  "based",
  "seasonal",
  "aspect",
  "franchise",
  "universe",
  "video_format",
] as const;

const STYLED_KINDS = ["network", "country", "chart", "streaming"] as const;

const PERSON_KINDS = ["actor", "director"] as const;

const PERSON_STYLES = ["bw", "rainier", "signature", "diiivoy", "diiivoycolor"] as const;

const STYLED_KIND_STYLES = ["color", "white"] as const;

export type FlatKind = (typeof FLAT_KINDS)[number];
export type StyledKind = (typeof STYLED_KINDS)[number];
export type PersonKind = (typeof PERSON_KINDS)[number];
export type PersonStyle = (typeof PERSON_STYLES)[number];
export type StyledKindStyle = (typeof STYLED_KIND_STYLES)[number];

export const kometaPosterSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    provider: z.literal("kometa"),
    kind: z.enum(FLAT_KINDS),
    name: z.string().min(1),
  }),
  z.object({
    provider: z.literal("kometa"),
    kind: z.enum(STYLED_KINDS),
    name: z.string().min(1),
    style: z.enum(STYLED_KIND_STYLES).optional(),
  }),
  z.object({
    provider: z.literal("kometa"),
    kind: z.enum(PERSON_KINDS),
    name: z.string().min(1),
    style: z.enum(PERSON_STYLES).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
]);

export type KometaPosterSource = z.infer<typeof kometaPosterSourceSchema>;

export const KOMETA_KINDS = [...FLAT_KINDS, ...STYLED_KINDS, ...PERSON_KINDS] as const;
export type KometaKind = (typeof KOMETA_KINDS)[number];

const FLAT_SET: ReadonlySet<string> = new Set(FLAT_KINDS);
const STYLED_SET: ReadonlySet<string> = new Set(STYLED_KINDS);
const PERSON_SET: ReadonlySet<string> = new Set(PERSON_KINDS);

function firstLetter(name: string): string {
  const ch = name.trim()[0]?.toUpperCase() ?? "";
  return /[A-Z]/.test(ch) ? ch : "0";
}

export function resolveKometaUrl(source: KometaPosterSource): string {
  const trimmed = source.name.trim();

  if (FLAT_SET.has(source.kind)) {
    return `${DEFAULT_IMAGES}/${source.kind}/${encodeURIComponent(trimmed)}.jpg`;
  }

  if (STYLED_SET.has(source.kind)) {
    const style = (source as { style?: StyledKindStyle }).style ?? "color";
    return `${DEFAULT_IMAGES}/${source.kind}/${style}/${encodeURIComponent(trimmed)}.jpg`;
  }

  if (PERSON_SET.has(source.kind)) {
    const style = (source as { style?: PersonStyle }).style ?? "bw";
    const offset = (source as { offset?: number }).offset ?? 0;
    const suffix = offset > 0 ? ` (${offset})` : "";
    return `https://raw.githubusercontent.com/Kometa-Team/People-Images-${style}/master/${firstLetter(trimmed)}/Images/${encodeURIComponent(trimmed + suffix)}.jpg`;
  }

  throw new Error(`Unknown Kometa kind: ${(source as { kind: string }).kind}`);
}

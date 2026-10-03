/**
 * The "customise your Plex" preroll card — what it says and how it looks.
 *
 * Shared because the admin form renders its inputs and bounds, the server
 * renders the frame, and neither may import the other.
 *
 * Two schemas on purpose. `portalPrerollCardSchema` is what the config store
 * reads back: every field optional and unconstrained, because `configSchema`
 * also runs on read and a tightened bound would turn an old row into a throw
 * out of every config read. `portalPrerollCardInput` is the strict one, applied
 * at the mutation that writes it.
 */
import { z } from "zod";

export const PORTAL_PREROLL_DURATION_MIN = 4;
export const PORTAL_PREROLL_DURATION_MAX = 30;
export const PORTAL_PREROLL_HEADLINE_MAX = 60;
export const PORTAL_PREROLL_MESSAGE_MAX = 200;

export const PORTAL_PREROLL_DEFAULTS = {
  headline: "Make this Plex yours",
  message: "Sign in with your Plex account to choose what shows up on your home screen.",
  durationSeconds: 8,
  background: "#14161b",
  foreground: "#f2f2f2",
  accent: "#e5a00d",
  showQr: true,
} as const;

export const portalPrerollCardSchema = z.object({
  /** Blank means "use the portal's public URL" (`user_app_public_url`). */
  url: z.string().optional(),
  headline: z.string().optional(),
  message: z.string().optional(),
  durationSeconds: z.number().optional(),
  background: z.string().optional(),
  foreground: z.string().optional(),
  accent: z.string().optional(),
  showQr: z.boolean().optional(),
});

export type PortalPrerollCard = z.infer<typeof portalPrerollCardSchema>;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex colour, like #e5a00d");

export const portalPrerollCardInput = z.object({
  url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "Use a full address starting with http:// or https://"),
  headline: z.string().trim().min(1).max(PORTAL_PREROLL_HEADLINE_MAX),
  message: z.string().trim().max(PORTAL_PREROLL_MESSAGE_MAX),
  durationSeconds: z.number().int().min(PORTAL_PREROLL_DURATION_MIN).max(PORTAL_PREROLL_DURATION_MAX),
  background: hex,
  foreground: hex,
  accent: hex,
  showQr: z.boolean(),
});

export type PortalPrerollCardInput = z.infer<typeof portalPrerollCardInput>;

/** A stored (possibly partial, possibly legacy) card with every gap defaulted. */
export function resolvePortalPrerollCard(stored: PortalPrerollCard | undefined): Omit<PortalPrerollCardInput, "url"> & {
  url: string;
} {
  const d = PORTAL_PREROLL_DEFAULTS;
  return {
    url: stored?.url ?? "",
    headline: stored?.headline || d.headline,
    message: stored?.message ?? d.message,
    durationSeconds: stored?.durationSeconds ?? d.durationSeconds,
    background: stored?.background || d.background,
    foreground: stored?.foreground || d.foreground,
    accent: stored?.accent || d.accent,
    showQr: stored?.showQr ?? d.showQr,
  };
}

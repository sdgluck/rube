/**
 * Curated set of header icons offered to admins for the portal. Imported
 * explicitly (not `import *`) so only these icons land in the bundle.
 */
import {
  Sparkles,
  Star,
  Heart,
  Film,
  Tv,
  Video,
  Music,
  Flame,
  Ghost,
  Rocket,
  Compass,
  Sun,
  Moon,
  Zap,
  Bookmark,
  Award,
  Bell,
  Camera,
  Tag,
  Play,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  Star,
  Heart,
  Film,
  Tv,
  Video,
  Music,
  Flame,
  Ghost,
  Rocket,
  Compass,
  Sun,
  Moon,
  Zap,
  Bookmark,
  Award,
  Bell,
  Camera,
  Tag,
  Play,
};

export const DEFAULT_PORTAL_ICON = "Sparkles";
export const PORTAL_ICONS = Object.keys(ICON_MAP);

export function getPortalIcon(name?: string): LucideIcon {
  return ICON_MAP[name ?? ""] ?? ICON_MAP[DEFAULT_PORTAL_ICON];
}

import { useSyncExternalStore } from "react";
import { getThemeMode, resolveTheme, subscribeTheme, type ResolvedTheme, type ThemeMode } from "#/theme";

/**
 * The current colour-scheme mode and what it resolves to.
 *
 * `useSyncExternalStore` rather than state in a provider: the theme store is
 * already the source of truth for the DOM attribute, and a provider would make
 * every consumer depend on being inside it — including the app bar, which
 * renders above most of the tree.
 */
export default function useTheme(): { mode: ThemeMode; resolved: ResolvedTheme } {
  const mode = useSyncExternalStore(subscribeTheme, getThemeMode, () => "system" as ThemeMode);
  return { mode, resolved: resolveTheme(mode) };
}

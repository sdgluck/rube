import { useEffect } from "react";
import { trpc } from "#/trpc";
import { hasStoredTheme, setThemeMode, THEME_MODES, type ThemeMode } from "#/theme";

/**
 * Adopts the server's stored colour scheme on a browser that has never chosen
 * one, so the preference follows the admin to a new machine.
 *
 * Deliberately one-way and one-shot. A browser that *has* chosen keeps its
 * choice: the reverse — config overwriting a local pick on every page load —
 * would make the toggle appear to work and then silently undo itself the next
 * time the config query refetched.
 */
export default function useThemeConfigSync(): void {
  const { data } = trpc.config.get.useQuery(undefined, { staleTime: Infinity });
  const stored = data?.ui_theme;

  useEffect(() => {
    if (!stored || hasStoredTheme()) return;
    if (!(THEME_MODES as readonly string[]).includes(stored)) return;
    setThemeMode(stored as ThemeMode, { persist: false });
  }, [stored]);
}

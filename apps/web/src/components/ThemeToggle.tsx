import { Monitor, Moon, Sun } from "lucide-react";
import { trpc } from "#/trpc";
import useTheme from "#hooks/useTheme";
import { setThemeMode, type ThemeMode } from "#/theme";
import styles from "./ThemeToggle.module.css";

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/**
 * The System / Light / Dark control.
 *
 * Writes through to the theme store — which repaints `<html>` immediately —
 * and then to config in the background. The save is deliberately not awaited
 * and its failure is not surfaced: the scheme has already changed and the
 * browser has already remembered it, so the only thing a failed round trip
 * costs is the preference not following you to another machine, which is not
 * worth a red toast over a colour.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { mode } = useTheme();
  const save = trpc.config.save.useMutation();
  const utils = trpc.useUtils();

  const choose = (next: ThemeMode) => {
    setThemeMode(next);
    save.mutate({ ui_theme: next }, { onSuccess: () => void utils.config.get.invalidate() });
  };

  return (
    <div className={`${styles.group} ${compact ? styles.icons : ""}`} role="radiogroup" aria-label="Colour scheme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          aria-label={compact ? `${label} theme` : undefined}
          title={compact ? `${label} theme` : undefined}
          className={`${styles.item} ${mode === value ? styles.itemActive : ""}`}
          onClick={() => choose(value)}
        >
          <Icon size={14} aria-hidden />
          {!compact && <span className={styles.label}>{label}</span>}
        </button>
      ))}
    </div>
  );
}

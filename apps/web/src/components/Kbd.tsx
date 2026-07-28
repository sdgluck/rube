import styles from "./Kbd.module.css";

/**
 * The platform's primary modifier. Shortcut handlers accept both metaKey and
 * ctrlKey, so this only affects what we *display* — but showing "⌘K" to
 * someone on Windows or Linux is telling them the wrong key.
 */
export const MOD_KEY = /mac|iphone|ipad|ipod/i.test(
  // userAgentData is the modern signal; userAgent is the fallback. Both are
  // absent during SSR/tests, where "Ctrl" is the safer default.
  (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.userAgent ?? "",
)
  ? "⌘"
  : "Ctrl";

/** Human-readable form of a modifier chord, e.g. "⌘K" or "Ctrl+K". */
export function modChord(key: string): string {
  return MOD_KEY === "⌘" ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`;
}

export default function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

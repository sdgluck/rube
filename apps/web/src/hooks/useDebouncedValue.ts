import { useEffect, useState } from "react";

/**
 * Returns `value` debounced by `delayMs`. The same useEffect+setTimeout
 * pattern was open-coded in Collections, Media, Users, and Events — this
 * hook is the shared implementation.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

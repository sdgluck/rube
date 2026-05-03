export function readEnum<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readEnumStorage<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  return readEnum(localStorage.getItem(key), allowed, fallback);
}

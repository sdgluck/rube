/**
 * The `fields[]` provider convention.
 *
 * Indexers, download clients, notifications, import lists and metadata
 * consumers are all "providers" in Servarr's model: a named implementation
 * plus a list of self-describing fields. The app publishes the shape at
 * `/{provider}/schema`, which means a form can be *rendered* from the API
 * rather than hand-written per provider — one renderer covers five settings
 * areas across three apps, and a provider added by an upstream release works
 * without a Tinkerbell change.
 *
 * This module owns the parts of that convention that are safety-critical:
 * knowing which fields are secret, and merging edits back without dropping
 * anything.
 */

export interface ServarrField {
  name: string;
  label?: string;
  value?: unknown;
  /** textbox | password | checkbox | select | number | tag | path | … */
  type?: string;
  /** normal | password | apiKey | userName */
  privacy?: string;
  helpText?: string;
  advanced?: boolean;
  selectOptions?: Array<{ value: number | string; name: string; hint?: string }>;
}

export interface ServarrProvider {
  id?: number;
  name: string;
  implementation: string;
  implementationName?: string;
  configContract?: string;
  enable?: boolean;
  tags?: number[];
  fields: ServarrField[];
}

/** Field privacies whose value must never be stored or shown. */
const SECRET_PRIVACY = new Set(["password", "apiKey"]);

export function isSecretField(field: ServarrField): boolean {
  return SECRET_PRIVACY.has(field.privacy ?? "normal");
}

/**
 * Blank every secret value in a provider, for storage or display.
 *
 * Applied before a provider ever reaches a settings snapshot. Most *Arr
 * versions already answer GET with `********`, but not all of them and not for
 * every provider — relying on that would mean the one that doesn't silently
 * writes an indexer's API key into our database in the clear.
 *
 * Structural comparison still works afterwards, which is what matters for
 * drift detection: "these two Radarrs point at different indexers" is a
 * question about names and implementations, not about keys.
 */
export function redactProviderSecrets(provider: ServarrProvider): ServarrProvider {
  return {
    ...provider,
    fields: provider.fields.map((f) => (isSecretField(f) && f.value ? { ...f, value: "" } : f)),
  };
}

/**
 * Apply edited values onto a schema, keeping every field the schema declares.
 *
 * The merge is schema-driven rather than edit-driven on purpose. A Servarr PUT
 * replaces the provider wholesale, so a field the UI did not know about — one
 * added by a newer release than the renderer understands — would be dropped
 * from the body and silently reset. Walking the schema means an unknown field
 * keeps whatever it already had.
 */
export function mergeFieldValues(schema: ServarrField[], values: Record<string, unknown>): ServarrField[] {
  return schema.map((field) => (field.name in values ? { ...field, value: values[field.name] } : field));
}

/**
 * The secret values a caller must re-supply after a redacted round-trip.
 *
 * A form populated from a redacted snapshot posts back blanks for the secrets.
 * Writing those would wipe working credentials, so the write path asks this
 * which fields to leave alone unless the user actually typed something.
 */
export function secretFieldNames(provider: ServarrProvider): string[] {
  return provider.fields.filter(isSecretField).map((f) => f.name);
}

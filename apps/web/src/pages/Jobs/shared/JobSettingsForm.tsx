/**
 * Rows for a command's settings, rendered from its field descriptors in
 * contracts. Controlled: the caller owns the draft, so the same rows serve the
 * job page and the feature wizard.
 */
import { useState } from "react";
import type { FieldSpec } from "@rube/contracts";
import ToggleSwitch from "#components/ToggleSwitch";
import MultiSelect, { type MultiSelectOption } from "#components/MultiSelect";
import { trpc } from "#/trpc";
import styles from "#pages/Jobs/Jobs.module.css";
import SectionsRow from "./rows/SectionsRow";
import { isVisible, type Draft } from "./config-draft";

interface Props {
  fields: FieldSpec[];
  draft: Draft;
  onChange: (next: Draft) => void;
  errors: Record<string, string>;
}

/** Problems the browser can see before a round trip: a blank or out-of-range number. */
export function draftErrors(fields: FieldSpec[], draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.control.kind !== "number" || !isVisible(field, draft)) continue;
    const value = draft[field.key];
    const { min, max } = field.control;
    if (typeof value !== "number" || !Number.isInteger(value)) errors[field.key] = "Enter a whole number";
    else if (value < min) errors[field.key] = `At least ${min}`;
    else if (max !== undefined && value > max) errors[field.key] = `At most ${max}`;
  }
  return errors;
}

type PickerOptions = { users: MultiSelectOption[]; optedInUsers: MultiSelectOption[] };

/**
 * A stored selection that no longer resolves — a user who left the server — is
 * kept as a visible "not found" option rather than
 * dropped from the list, so saving can't silently change the target and the
 * admin can see and remove it.
 */
function withMissing(options: MultiSelectOption[], selected: string[]): MultiSelectOption[] {
  const known = new Set(options.map((o) => o.value));
  return [...options, ...selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: `${v} (not found)` }))];
}

function Control({
  field,
  value,
  onChange,
  pickers,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (next: unknown) => void;
  pickers?: PickerOptions;
}) {
  const { control } = field;
  switch (control.kind) {
    case "number":
      return (
        <>
          <input
            type="number"
            className={styles.configNumberInput}
            min={control.min}
            max={control.max}
            // Kept as typed, not clamped on every keystroke: clamping made it
            // impossible to clear a field and type a new two-digit number.
            value={typeof value === "number" && Number.isFinite(value) ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          {control.unit && <span className={styles.configUnit}>{control.unit}</span>}
        </>
      );
    case "boolean":
      return <ToggleSwitch size="sm" checked={value === true} onChange={onChange} />;
    case "enum":
      return (
        <select className={styles.configSelect} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {control.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "users": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const base = control.source === "opted-in" ? (pickers?.optedInUsers ?? []) : (pickers?.users ?? []);
      return (
        <MultiSelect
          allLabel={control.source === "opted-in" ? "All opted-in users" : "All users"}
          ariaLabel={field.label}
          options={withMissing(base, selected)}
          selected={selected}
          onChange={onChange}
        />
      );
    }
    default:
      return null;
  }
}

function enumHelp(field: FieldSpec, value: unknown): string | undefined {
  if (field.control.kind !== "enum") return undefined;
  return field.control.options.find((o) => o.value === value)?.help;
}

export default function JobSettingsForm({ fields, draft, onChange, errors }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const visible = fields.filter((f) => isVisible(f, draft));
  const basic = visible.filter((f) => !f.advanced);
  const advanced = visible.filter((f) => f.advanced);
  // An advanced field with a problem is opened rather than hidden behind the toggle.
  const advancedOpen = showAdvanced || advanced.some((f) => errors[f.key]);

  const set = (key: string, value: unknown) => onChange({ ...draft, [key]: value });

  const needsPickers = fields.some((f) => f.control.kind === "users");
  const optionsQuery = trpc.jobs.fieldOptions.useQuery(undefined, { enabled: needsPickers });
  const pickers: PickerOptions | undefined = optionsQuery.data && {
    users: optionsQuery.data.users.map((u) => ({ value: u.username, label: u.label })),
    optedInUsers: optionsQuery.data.users.filter((u) => u.optedIn).map((u) => ({ value: u.username, label: u.label })),
  };

  const row = (field: FieldSpec) => {
    if (field.control.kind === "sections") {
      return (
        <SectionsRow
          key={field.key}
          label={field.label}
          selected={(draft[field.key] as string[]) ?? []}
          onChange={(next) => set(field.key, next)}
        />
      );
    }
    const help = enumHelp(field, draft[field.key]) ?? field.help;
    return (
      <tr key={field.key}>
        <td className={styles.fieldLabel}>{field.label}</td>
        <td>
          <Control field={field} value={draft[field.key]} onChange={(next) => set(field.key, next)} pickers={pickers} />
          {errors[field.key] ? (
            <div className={styles.fieldHelpError}>{errors[field.key]}</div>
          ) : (
            help && <div className={styles.fieldHelp}>{help}</div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <>
      {basic.map(row)}
      {advanced.length > 0 && (
        <tr>
          <td colSpan={2}>
            <button
              type="button"
              className={styles.advancedToggle}
              aria-expanded={advancedOpen}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {advancedOpen ? "Hide advanced settings" : `Advanced settings (${advanced.length})`}
            </button>
          </td>
        </tr>
      )}
      {advancedOpen && advanced.map(row)}
    </>
  );
}

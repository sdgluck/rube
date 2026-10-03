import { useRef } from "react";
import { METADATA_TOKENS } from "@tinkerbell/contracts";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import styles from "./RuleWizard.module.css";

/**
 * A metadata template field with its token vocabulary one click away.
 *
 * The tokens used to be listed in a sentence above the form, which meant
 * reading them, remembering the spelling and typing the braces. Picking one
 * inserts it where the cursor last was — or appends, if the field was never
 * focused — so a misspelt token is no longer the most likely error.
 */
export default function TemplateInput({
  id,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Where the caret was when the field lost focus to the token picker; null
  // until the field has been touched, which means "append".
  const caretRef = useRef<{ start: number; end: number } | null>(null);

  const remember = () => {
    const el = inputRef.current;
    if (el && el.selectionStart !== null)
      caretRef.current = { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart };
  };

  const insert = (token: string) => {
    const text = `{${token}}`;
    const { start, end } = caretRef.current ?? { start: value.length, end: value.length };
    onChange(value.slice(0, start) + text + value.slice(end));
    const caret = start + text.length;
    caretRef.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className={styles.templateRow}>
      <input
        ref={inputRef}
        id={id}
        className={shared.input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onSelect={remember}
        onBlur={remember}
      />
      <select
        className={controls.selectSm}
        value=""
        aria-label="Insert a token"
        onChange={(e) => e.target.value && insert(e.target.value)}
      >
        <option value="">+ Token</option>
        {METADATA_TOKENS.map((t) => (
          <option key={t} value={t}>{`{${t}}`}</option>
        ))}
      </select>
    </div>
  );
}

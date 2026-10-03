import controls from "#/styles/controls.module.css";
import styles from "./ColorField.module.css";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * An optional accent colour: "Auto" (empty string) or a picked hex.
 *
 * Every accent field in the app means the same thing by blank — take the
 * colour from the collection's own posters — and each used to say so in a
 * paragraph under a free-text box that also had to explain hex syntax. An
 * explicit Auto choice beside a native picker says both without prose, and
 * can't produce a malformed value.
 */
export default function ColorField({
  id,
  value,
  onChange,
  disabled,
  autoLabel = "Auto",
  autoTitle = "Taken from the collection's posters",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoLabel?: string;
  autoTitle?: string;
}) {
  const auto = value.trim() === "";
  // The native picker can't hold "nothing", so show a neutral starting point
  // while Auto is selected; picking anything switches to Custom.
  const pickerValue = HEX.test(value) ? value : "#808080";
  return (
    <div className={styles.row}>
      <div className={controls.segmented} role="radiogroup">
        <button
          type="button"
          role="radio"
          aria-checked={auto}
          title={autoTitle}
          className={`${controls.segmentedItem} ${auto ? controls.segmentedItemActive : ""}`}
          onClick={() => onChange("")}
          disabled={disabled}
        >
          {autoLabel}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!auto}
          className={`${controls.segmentedItem} ${!auto ? controls.segmentedItemActive : ""}`}
          onClick={() => auto && onChange(pickerValue)}
          disabled={disabled}
        >
          Custom
        </button>
      </div>
      {!auto && (
        <input
          id={id}
          type="color"
          className={styles.swatch}
          value={pickerValue}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          disabled={disabled}
          aria-label="Accent colour"
        />
      )}
    </div>
  );
}

import { useSyncExternalStore } from "react";
import { UI_SCALES, type UiScale } from "@rube/contracts";
import { trpc } from "#/trpc";
import { getUiScale, setUiScale, subscribeUiScale } from "#/ui-scale";
import controls from "#/styles/controls.module.css";

/**
 * The Interface size control. Same write-through as `ThemeToggle`: the page
 * resizes immediately and the browser remembers; the config save that makes it
 * follow the admin to another machine runs in the background, unawaited.
 */
export default function UiScalePicker() {
  const scale = useSyncExternalStore(subscribeUiScale, getUiScale, getUiScale);
  const save = trpc.config.save.useMutation();
  const utils = trpc.useUtils();

  const choose = (next: UiScale) => {
    setUiScale(next);
    save.mutate({ ui_scale: next }, { onSuccess: () => void utils.config.get.invalidate() });
  };

  return (
    <div className={controls.segmented} role="radiogroup" aria-label="Interface size">
      {UI_SCALES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={scale === value}
          className={`${controls.segmentedItem} ${scale === value ? controls.segmentedItemActive : ""}`}
          onClick={() => choose(value)}
        >
          {Math.round(value * 100)}%
        </button>
      ))}
    </div>
  );
}

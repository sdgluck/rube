import { Sparkles } from "lucide-react";
import {
  buildPreset,
  diffSchedulePlans,
  diffScheduleSettings,
  SCHEDULE_PRESETS,
  type ScheduleContext,
  type SchedulePlan,
} from "@rube/contracts";
import styles from "./Schedule.module.css";

/**
 * One click each, into the draft — never straight to the server. The card says
 * how much it would move before you press it, and Undo takes it back after.
 */
export default function PresetPicker({
  ctx,
  current,
  onApply,
}: {
  ctx: ScheduleContext;
  current: SchedulePlan;
  onApply: (plan: SchedulePlan, name: string) => void;
}) {
  return (
    <div className={styles.presets}>
      {SCHEDULE_PRESETS.map((preset) => {
        const plan = buildPreset(preset.id, ctx, current);
        const moves = diffSchedulePlans(current, plan).length;
        const settings = diffScheduleSettings(current, plan).length;
        const already = moves === 0 && settings === 0;
        return (
          <button
            key={preset.id}
            type="button"
            className={preset.id === "recommended" ? styles.presetRecommended : styles.preset}
            onClick={() => onApply(plan, preset.name)}
            disabled={already}
          >
            <span className={styles.presetName}>
              {preset.id === "recommended" && <Sparkles size="1.3rem" aria-hidden="true" />}
              {preset.name}
            </span>
            <span className={styles.presetDescription}>{preset.description}</span>
            <span className={styles.presetEffect}>
              {already
                ? "Already applied"
                : [
                    moves > 0 ? `Moves ${moves} job${moves === 1 ? "" : "s"}` : "",
                    settings > 0 ? "changes the window" : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

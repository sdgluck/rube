import ToggleSwitch from "#components/ToggleSwitch";
import styles from "#pages/Jobs/Jobs.module.css";

export interface BywFormState {
  limit: number;
  mode: "per-user" | "server";
  users: string;
  pin: boolean;
  minItems: number;
  maxItems: number;
  minLib: number;
}

interface Props {
  state: BywFormState;
  onChange: (next: BywFormState) => void;
}

export default function BywConfigRows({ state, onChange }: Props) {
  const set = <K extends keyof BywFormState>(key: K, value: BywFormState[K]) => onChange({ ...state, [key]: value });

  return (
    <>
      <tr>
        <td className={styles.fieldLabel}>Limit</td>
        <td>
          <input
            type="number"
            className={styles.configNumberInput}
            min={1}
            max={50}
            value={state.limit}
            onChange={(e) => set("limit", Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
          />
          <div className={styles.fieldHelp}>
            {state.limit} collection{state.limit !== 1 ? "s" : ""} per section
          </div>
        </td>
      </tr>
      <tr>
        <td className={styles.fieldLabel}>Mode</td>
        <td>
          <select
            className={styles.configNumberInput}
            style={{ width: "auto" }}
            value={state.mode}
            onChange={(e) => set("mode", e.target.value as "per-user" | "server")}
          >
            <option value="per-user">Per user</option>
            <option value="server">Server-wide</option>
          </select>
          <div className={styles.fieldHelp}>
            {state.mode === "per-user"
              ? "One set of collections per Plex user"
              : "Single shared set, all users' history"}
          </div>
        </td>
      </tr>
      {state.mode === "per-user" && (
        <tr>
          <td className={styles.fieldLabel}>Users</td>
          <td>
            <input
              type="text"
              className={styles.configNumberInput}
              style={{ width: "100%", maxWidth: 280 }}
              placeholder="all users"
              value={state.users}
              onChange={(e) => set("users", e.target.value)}
            />
            <div className={styles.fieldHelp}>{state.users.trim() ? "Comma-separated allowlist" : "All users"}</div>
          </td>
        </tr>
      )}
      <tr>
        <td className={styles.fieldLabel}>Pin to homepage</td>
        <td>
          <ToggleSwitch size="sm" checked={state.pin} onChange={(checked) => set("pin", checked)} />
        </td>
      </tr>
      <tr>
        <td className={styles.fieldLabel}>Items per collection</td>
        <td>
          <input
            type="number"
            className={styles.configNumberInput}
            min={5}
            max={50}
            value={state.minItems}
            onChange={(e) => set("minItems", Math.max(5, Math.min(50, parseInt(e.target.value, 10) || 10)))}
          />
          <span style={{ margin: "0 6px" }}>–</span>
          <input
            type="number"
            className={styles.configNumberInput}
            min={10}
            max={100}
            value={state.maxItems}
            onChange={(e) => set("maxItems", Math.max(10, Math.min(100, parseInt(e.target.value, 10) || 30)))}
          />
          <div className={styles.fieldHelp}>
            {state.minItems}–{state.maxItems} items
          </div>
        </td>
      </tr>
      <tr>
        <td className={styles.fieldLabel}>Min library size</td>
        <td>
          <input
            type="number"
            className={styles.configNumberInput}
            min={1}
            value={state.minLib}
            onChange={(e) => set("minLib", Math.max(1, parseInt(e.target.value, 10) || 15))}
          />
          <div className={styles.fieldHelp}>Skip sections with fewer items</div>
        </td>
      </tr>
    </>
  );
}

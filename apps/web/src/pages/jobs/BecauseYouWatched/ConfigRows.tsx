import ToggleSwitch from "#/ToggleSwitch";
import styles from "#pages/Jobs.module.css";

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
        <td>Limit</td>
        <td>
          <input
            type="number"
            className={styles.configNumberInput}
            min={1}
            max={50}
            value={state.limit}
            onChange={(e) => set("limit", Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
          />
        </td>
        <td className={styles.configSummary}>
          {state.limit} collection{state.limit !== 1 ? "s" : ""} per section
        </td>
      </tr>
      <tr>
        <td>Mode</td>
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
        </td>
        <td className={styles.configSummary}>
          {state.mode === "per-user" ? "One set of collections per Plex user" : "Single shared set, all users' history"}
        </td>
      </tr>
      {state.mode === "per-user" && (
        <tr>
          <td>Users</td>
          <td>
            <input
              type="text"
              className={styles.configNumberInput}
              style={{ width: "100%", maxWidth: 280 }}
              placeholder="all users"
              value={state.users}
              onChange={(e) => set("users", e.target.value)}
            />
          </td>
          <td className={styles.configSummary}>{state.users.trim() ? "Comma-separated allowlist" : "All users"}</td>
        </tr>
      )}
      <tr>
        <td>Pin to homepage</td>
        <td>
          <ToggleSwitch size="sm" checked={state.pin} onChange={(checked) => set("pin", checked)} />
        </td>
        <td className={styles.configSummary}>{state.pin ? "Yes" : "No"}</td>
      </tr>
      <tr>
        <td>Items per collection</td>
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
        </td>
        <td className={styles.configSummary}>
          {state.minItems}–{state.maxItems} items
        </td>
      </tr>
      <tr>
        <td>Min library size</td>
        <td>
          <input
            type="number"
            className={styles.configNumberInput}
            min={1}
            value={state.minLib}
            onChange={(e) => set("minLib", Math.max(1, parseInt(e.target.value, 10) || 15))}
          />
        </td>
        <td className={styles.configSummary}>Skip sections with fewer items</td>
      </tr>
    </>
  );
}

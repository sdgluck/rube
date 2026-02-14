import { useState, useEffect } from "react";
import { getConfig, saveConfig } from "../api";
import styles from "./Settings.module.css";

const FIELDS = [
  {
    key: "plex_url",
    label: "Plex URL",
    type: "text",
    placeholder: "http://localhost:32400",
  },
  {
    key: "plex_token",
    label: "Plex Token",
    type: "password",
    placeholder: "Enter token",
  },
  {
    key: "anthropic_api_key",
    label: "AI Token",
    type: "password",
    placeholder: "Enter API key",
  },
];

export default function Settings() {
  const [values, setValues] = useState({});
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfig()
      .then(setValues)
      .catch(() => setStatus({ type: "error", msg: "Failed to load settings" }))
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);
    try {
      const data = {};
      for (const f of FIELDS) data[f.key] = values[f.key] || "";
      await saveConfig(data);
      setStatus({ type: "success", msg: "Settings saved" });
    } catch {
      setStatus({ type: "error", msg: "Failed to save settings" });
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h2 className={styles.heading}>Settings</h2>
      {status && (
        <div className={`${styles.toast} ${styles[status.type]}`}>
          {status.msg}
        </div>
      )}
      <form onSubmit={handleSubmit} className={styles.form}>
        {FIELDS.map((f) => (
          <label key={f.key} className={styles.field}>
            <span className={styles.label}>{f.label}</span>
            <input
              type={f.type}
              className={styles.input}
              placeholder={f.placeholder}
              value={values[f.key] || ""}
              onChange={(e) =>
                setValues({ ...values, [f.key]: e.target.value })
              }
            />
          </label>
        ))}
        <button type="submit" className={styles.button}>
          Save
        </button>
      </form>
    </div>
  );
}

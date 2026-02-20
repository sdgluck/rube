import { useState, useEffect } from "react";
import { trpc } from "../trpc";
import styles from "./Settings.module.css";

interface Status {
  type: "success" | "error";
  msg: string;
}

export default function SettingsDatabases() {
  const [omdbApiKey, setOmdbApiKey] = useState("");
  const [omdbStatus, setOmdbStatus] = useState<Status | null>(null);
  const [savingOmdb, setSavingOmdb] = useState(false);

  const [mdblistApiKey, setMdblistApiKey] = useState("");
  const [mdblistStatus, setMdblistStatus] = useState<Status | null>(null);
  const [savingMdblist, setSavingMdblist] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const saveConfigMutation = trpc.config.save.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setOmdbApiKey(configQuery.data.global_omdb_api_key || "");
      setMdblistApiKey(configQuery.data.global_mdblist_api_key || "");
    }
  }, [configQuery.data]);

  const handleSaveOmdb = async () => {
    setOmdbStatus(null);
    setSavingOmdb(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_omdb_api_key: omdbApiKey,
      });
      setOmdbStatus({ type: "success", msg: "OMDB settings saved" });
    } catch {
      setOmdbStatus({ type: "error", msg: "Failed to save OMDB settings" });
    } finally {
      setSavingOmdb(false);
    }
  };

  const handleSaveMdblist = async () => {
    setMdblistStatus(null);
    setSavingMdblist(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_mdblist_api_key: mdblistApiKey,
      });
      setMdblistStatus({ type: "success", msg: "MDBList settings saved" });
    } catch {
      setMdblistStatus({ type: "error", msg: "Failed to save MDBList settings" });
    } finally {
      setSavingMdblist(false);
    }
  };

  if (configQuery.isLoading) return <p>Loading...</p>;
  if (configQuery.error) return <div className={`${styles.toast} ${styles.error}`}>Failed to load settings</div>;

  return (
    <div className={styles.form}>
      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>OMDB</legend>
        <label className={styles.field}>
          <span className={styles.label}>OMDB API Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter OMDB API key"
            value={omdbApiKey}
            onChange={(e) => setOmdbApiKey(e.target.value)}
          />
          <span className={styles.hint}>Free tier: 1,000 requests/day. Get a key at omdbapi.com</span>
        </label>
        {omdbStatus && <div className={`${styles.toast} ${styles[omdbStatus.type]}`}>{omdbStatus.msg}</div>}
        <button type="button" className={styles.button} onClick={handleSaveOmdb} disabled={savingOmdb}>
          {savingOmdb ? "Saving..." : "Save"}
        </button>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>MDBList</legend>
        <label className={styles.field}>
          <span className={styles.label}>MDBList API Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter MDBList API key"
            value={mdblistApiKey}
            onChange={(e) => setMdblistApiKey(e.target.value)}
          />
          <span className={styles.hint}>Get a key at mdblist.com/preferences</span>
        </label>
        {mdblistStatus && <div className={`${styles.toast} ${styles[mdblistStatus.type]}`}>{mdblistStatus.msg}</div>}
        <button type="button" className={styles.button} onClick={handleSaveMdblist} disabled={savingMdblist}>
          {savingMdblist ? "Saving..." : "Save"}
        </button>
      </fieldset>
    </div>
  );
}

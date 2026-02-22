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
  const [testingOmdb, setTestingOmdb] = useState(false);

  const [mdblistApiKey, setMdblistApiKey] = useState("");
  const [mdblistStatus, setMdblistStatus] = useState<Status | null>(null);
  const [savingMdblist, setSavingMdblist] = useState(false);
  const [testingMdblist, setTestingMdblist] = useState(false);

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const testOmdbMutation = trpc.testOmdb.useMutation();
  const testMdblistMutation = trpc.testMdblist.useMutation();

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

  const handleTestOmdb = async () => {
    setOmdbStatus(null);
    if (!omdbApiKey) {
      setOmdbStatus({ type: "error", msg: "API key is required" });
      return;
    }
    setTestingOmdb(true);
    try {
      const result = await testOmdbMutation.mutateAsync({ api_key: omdbApiKey });
      if (result.ok) {
        setOmdbStatus({ type: "success", msg: `Connected — found "${result.title}"` });
      } else {
        setOmdbStatus({ type: "error", msg: result.error || "Connection test failed" });
      }
    } catch {
      setOmdbStatus({ type: "error", msg: "Connection test failed" });
    } finally {
      setTestingOmdb(false);
      utils.health.status.invalidate();
    }
  };

  const handleTestMdblist = async () => {
    setMdblistStatus(null);
    if (!mdblistApiKey) {
      setMdblistStatus({ type: "error", msg: "API key is required" });
      return;
    }
    setTestingMdblist(true);
    try {
      const result = await testMdblistMutation.mutateAsync({ api_key: mdblistApiKey });
      if (result.ok) {
        setMdblistStatus({ type: "success", msg: `Connected — ${result.name}` });
      } else {
        setMdblistStatus({ type: "error", msg: result.error || "Connection test failed" });
      }
    } catch {
      setMdblistStatus({ type: "error", msg: "Connection test failed" });
    } finally {
      setTestingMdblist(false);
      utils.health.status.invalidate();
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
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSaveOmdb} disabled={savingOmdb}>
            {savingOmdb ? "Saving..." : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTestOmdb} disabled={testingOmdb}>
            {testingOmdb ? "Testing..." : "Test Connection"}
          </button>
        </div>
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
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSaveMdblist} disabled={savingMdblist}>
            {savingMdblist ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={handleTestMdblist}
            disabled={testingMdblist}
          >
            {testingMdblist ? "Testing..." : "Test Connection"}
          </button>
        </div>
      </fieldset>
    </div>
  );
}

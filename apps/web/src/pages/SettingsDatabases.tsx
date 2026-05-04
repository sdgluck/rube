import { useState, useEffect, useMemo } from "react";
import { trpc } from "../trpc";
import { useToast } from "../Toast";
import UnsavedBanner from "../UnsavedBanner";
import useUnsavedChanges from "../useUnsavedChanges";
import { FormSkeleton } from "../Skeleton";
import styles from "./Settings.module.css";

export default function SettingsDatabases() {
  const [omdbApiKey, setOmdbApiKey] = useState("");
  const [savingOmdb, setSavingOmdb] = useState(false);
  const [testingOmdb, setTestingOmdb] = useState(false);

  const [mdblistApiKey, setMdblistApiKey] = useState("");
  const [savingMdblist, setSavingMdblist] = useState(false);
  const [testingMdblist, setTestingMdblist] = useState(false);

  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [savingTmdb, setSavingTmdb] = useState(false);
  const [testingTmdb, setTestingTmdb] = useState(false);

  const { addToast } = useToast();

  const configQuery = trpc.config.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const utils = trpc.useUtils();
  const saveConfigMutation = trpc.config.save.useMutation();
  const testOmdbMutation = trpc.testOmdb.useMutation();
  const testMdblistMutation = trpc.testMdblist.useMutation();
  const testTmdbMutation = trpc.testTmdb.useMutation();

  useEffect(() => {
    if (configQuery.data) {
      setOmdbApiKey(configQuery.data.global_omdb_api_key || "");
      setMdblistApiKey(configQuery.data.global_mdblist_api_key || "");
      setTmdbApiKey(configQuery.data.global_tmdb_api_key || "");
    }
  }, [configQuery.data]);

  const isDirtyOmdb = useMemo(() => {
    if (!configQuery.data) return false;
    return omdbApiKey !== (configQuery.data.global_omdb_api_key || "");
  }, [omdbApiKey, configQuery.data]);

  const isDirtyMdblist = useMemo(() => {
    if (!configQuery.data) return false;
    return mdblistApiKey !== (configQuery.data.global_mdblist_api_key || "");
  }, [mdblistApiKey, configQuery.data]);

  const isDirtyTmdb = useMemo(() => {
    if (!configQuery.data) return false;
    return tmdbApiKey !== (configQuery.data.global_tmdb_api_key || "");
  }, [tmdbApiKey, configQuery.data]);

  useUnsavedChanges(isDirtyOmdb || isDirtyMdblist || isDirtyTmdb);

  const handleSaveOmdb = async () => {
    setSavingOmdb(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_omdb_api_key: omdbApiKey,
      });
      addToast("OMDB settings saved", "success");
    } catch {
      addToast("Failed to save OMDB settings", "error");
    } finally {
      setSavingOmdb(false);
    }
  };

  const handleTestOmdb = async () => {
    if (!omdbApiKey) {
      addToast("API key is required", "error");
      return;
    }
    setTestingOmdb(true);
    try {
      const result = await testOmdbMutation.mutateAsync({ api_key: omdbApiKey });
      if (result.ok) {
        addToast(`Connected — found "${result.title}"`, "success");
      } else {
        addToast(result.error || "Connection test failed", "error");
      }
    } catch {
      addToast("Connection test failed", "error");
    } finally {
      setTestingOmdb(false);
      utils.health.status.invalidate();
    }
  };

  const handleTestMdblist = async () => {
    if (!mdblistApiKey) {
      addToast("API key is required", "error");
      return;
    }
    setTestingMdblist(true);
    try {
      const result = await testMdblistMutation.mutateAsync({ api_key: mdblistApiKey });
      if (result.ok) {
        addToast(`Connected — ${result.name}`, "success");
      } else {
        addToast(result.error || "Connection test failed", "error");
      }
    } catch {
      addToast("Connection test failed", "error");
    } finally {
      setTestingMdblist(false);
      utils.health.status.invalidate();
    }
  };

  const handleSaveTmdb = async () => {
    setSavingTmdb(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_tmdb_api_key: tmdbApiKey,
      });
      addToast("TMDb settings saved", "success");
    } catch {
      addToast("Failed to save TMDb settings", "error");
    } finally {
      setSavingTmdb(false);
    }
  };

  const handleTestTmdb = async () => {
    if (!tmdbApiKey) {
      addToast("API key is required", "error");
      return;
    }
    setTestingTmdb(true);
    try {
      const result = await testTmdbMutation.mutateAsync({ api_key: tmdbApiKey });
      if (result.ok) {
        addToast(`Connected — found "${result.sample}"`, "success");
      } else {
        addToast(result.error || "Connection test failed", "error");
      }
    } catch {
      addToast("Connection test failed", "error");
    } finally {
      setTestingTmdb(false);
      utils.health.status.invalidate();
    }
  };

  const handleSaveMdblist = async () => {
    setSavingMdblist(true);
    try {
      await saveConfigMutation.mutateAsync({
        global_mdblist_api_key: mdblistApiKey,
      });
      addToast("MDBList settings saved", "success");
    } catch {
      addToast("Failed to save MDBList settings", "error");
    } finally {
      setSavingMdblist(false);
    }
  };

  if (configQuery.isLoading) return <FormSkeleton rows={3} />;
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
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSaveOmdb} disabled={savingOmdb}>
            {savingOmdb ? "Saving..." : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTestOmdb} disabled={testingOmdb}>
            {testingOmdb ? "Testing..." : "Test Connection"}
          </button>
          <UnsavedBanner visible={isDirtyOmdb} />
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.groupTitle}>TMDb</legend>
        <label className={styles.field}>
          <span className={styles.label}>TMDb API Key</span>
          <input
            type="password"
            className={styles.input}
            placeholder="Enter TMDb v3 API key"
            value={tmdbApiKey}
            onChange={(e) => setTmdbApiKey(e.target.value)}
          />
          <span className={styles.hint}>
            Used by Popular Actors/Directors and Franchises rules. Get a key at themoviedb.org/settings/api
          </span>
        </label>
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={handleSaveTmdb} disabled={savingTmdb}>
            {savingTmdb ? "Saving..." : "Save"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={handleTestTmdb} disabled={testingTmdb}>
            {testingTmdb ? "Testing..." : "Test Connection"}
          </button>
          <UnsavedBanner visible={isDirtyTmdb} />
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
          <UnsavedBanner visible={isDirtyMdblist} />
        </div>
      </fieldset>
    </div>
  );
}

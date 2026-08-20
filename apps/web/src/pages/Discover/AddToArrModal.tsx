import { useEffect, useState } from "react";
import {
  MINIMUM_AVAILABILITY,
  SERIES_MONITOR_MODES,
  formatBytes,
  type MinimumAvailability,
  type SeriesMonitorMode,
} from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import Modal from "#components/Modal";
import Spinner from "#components/Spinner";
import ToggleSwitch from "#components/ToggleSwitch";
import ErrorState from "#components/ErrorState";
import { useToast } from "#components/Toast";
import { readJsonStorage, writeJsonStorage } from "#/storage";
import { addDefaults, type DiscoverResult } from "#lib/discover";
import controls from "#/styles/controls.module.css";
import styles from "./AddToArrModal.module.css";

/**
 * What the last add chose, per service.
 *
 * Remembered because the answer is the same nearly every time — one profile,
 * one root folder — and re-picking them for every film turns a one-click
 * action into a form. The *Arr's own values still win if the remembered one
 * has since been deleted.
 */
interface RememberedChoice {
  instanceId?: string;
  qualityProfileId?: number;
  rootFolderPath?: string;
  minimumAvailability?: MinimumAvailability;
  seriesMonitorMode?: SeriesMonitorMode;
}

const MONITOR_MODE_LABELS: Record<SeriesMonitorMode, string> = {
  all: "All episodes",
  future: "Future episodes",
  missing: "Missing episodes",
  existing: "Existing episodes",
  firstSeason: "First season",
  lastSeason: "Last season",
  latestSeason: "Latest season",
  pilot: "Pilot only",
  none: "None",
};

const AVAILABILITY_LABELS: Record<MinimumAvailability, string> = {
  tba: "Announced (TBA)",
  announced: "Announced",
  inCinemas: "In cinemas",
  released: "Released",
};

export default function AddToArrModal({
  result,
  onClose,
  onAdded,
}: {
  result: DiscoverResult;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { addToast } = useToast();
  const service = result.service;
  const storageKey = `tinkerbell.discover.add.${service}`;
  const remembered = readJsonStorage<RememberedChoice>(storageKey, {});

  const instancesQuery = trpc.arr.instances.useQuery();
  const instances = (instancesQuery.data ?? []).filter((i) => i.service === service);

  const [instanceId, setInstanceId] = useState<string | undefined>(remembered.instanceId);
  // The remembered instance may since have been removed from settings, in
  // which case fall back to the default rather than to nothing.
  const resolvedInstance = instances.find((i) => i.id === instanceId) ?? instances.find((i) => i.isDefault);
  const activeInstanceId = resolvedInstance?.id;

  const profilesQuery = trpc.arr.qualityProfiles.useQuery(
    { service, instanceId: activeInstanceId },
    { enabled: !!activeInstanceId, staleTime: 60_000 },
  );
  const foldersQuery = trpc.arr.rootFolders.useQuery(
    { service, instanceId: activeInstanceId },
    { enabled: !!activeInstanceId, staleTime: 60_000 },
  );

  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [monitor, setMonitor] = useState(true);
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [minimumAvailability, setMinimumAvailability] = useState<MinimumAvailability>(
    remembered.minimumAvailability ?? "released",
  );
  const [seriesMonitorMode, setSeriesMonitorMode] = useState<SeriesMonitorMode>(remembered.seriesMonitorMode ?? "all");

  const profiles = profilesQuery.data;
  const folders = foldersQuery.data;

  // Seed from what the instance actually offers, preferring the remembered
  // choice only when it still exists upstream.
  useEffect(() => {
    if (!profiles && !folders) return;
    const fallback = addDefaults(profiles, folders);
    setQualityProfileId((current) => {
      if (current !== null && profiles?.some((p) => p.id === current)) return current;
      const kept = profiles?.some((p) => p.id === remembered.qualityProfileId) ? remembered.qualityProfileId! : null;
      return kept ?? fallback.qualityProfileId;
    });
    setRootFolderPath((current) => {
      if (current !== null && folders?.some((f) => f.path === current)) return current;
      const kept = folders?.some((f) => f.path === remembered.rootFolderPath) ? remembered.rootFolderPath! : null;
      return kept ?? fallback.rootFolderPath;
    });
    // `remembered` is read once from storage per mount, so it is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, folders]);

  const add = trpc.discover.add.useMutation({
    onSuccess: (res) => {
      writeJsonStorage(storageKey, {
        instanceId: activeInstanceId,
        qualityProfileId: qualityProfileId ?? undefined,
        rootFolderPath: rootFolderPath ?? undefined,
        minimumAvailability,
        seriesMonitorMode,
      } satisfies RememberedChoice);
      // "Already there" is an outcome, not a failure — two rules, or two
      // people, can want the same film.
      addToast(
        res.status === "exists"
          ? `${result.title} is already in ${res.instanceName}`
          : `Added ${result.title} to ${res.instanceName}`,
        "success",
      );
      onAdded();
      onClose();
    },
    onError: (err) => addToast(err.message, "error"),
  });

  const ready = qualityProfileId !== null && rootFolderPath !== null && !!activeInstanceId;

  function submit() {
    if (!ready) return;
    add.mutate({
      mediaType: result.mediaType,
      tmdbId: result.tmdbId,
      instanceId: activeInstanceId,
      qualityProfileId,
      rootFolderPath,
      monitor,
      searchOnAdd,
      ...(service === "radarr" ? { minimumAvailability } : { seriesMonitorMode }),
    });
  }

  const loading = profilesQuery.isLoading || foldersQuery.isLoading;
  const loadError = profilesQuery.error ?? foldersQuery.error;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add ${result.title}`}
      meta={result.year ? String(result.year) : undefined}
      size="md"
      footer={
        <div className={styles.footer}>
          <button type="button" className={controls.btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={controls.btnPrimary} onClick={submit} disabled={!ready || add.isPending}>
            {add.isPending && <Spinner size="sm" />}
            {searchOnAdd ? "Add and search" : "Add"}
          </button>
        </div>
      }
    >
      {loadError ? (
        <ErrorState
          title={`Couldn't reach ${service === "radarr" ? "Radarr" : "Sonarr"}`}
          error={loadError}
          onRetry={() => {
            void profilesQuery.refetch();
            void foldersQuery.refetch();
          }}
          inline
        />
      ) : (
        <div className={styles.form}>
          {instances.length > 1 && (
            <label className={styles.field}>
              <span className={styles.label}>Instance</span>
              <select
                className={controls.select}
                value={activeInstanceId ?? ""}
                onChange={(e) => setInstanceId(e.target.value)}
              >
                {instances.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={styles.field}>
            <span className={styles.label}>Quality profile</span>
            <select
              className={controls.select}
              value={qualityProfileId ?? ""}
              onChange={(e) => setQualityProfileId(Number(e.target.value))}
              disabled={loading}
            >
              {(profiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Root folder</span>
            <select
              className={controls.select}
              value={rootFolderPath ?? ""}
              onChange={(e) => setRootFolderPath(e.target.value)}
              disabled={loading}
            >
              {(folders ?? []).map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                  {f.freeSpace ? ` — ${formatBytes(f.freeSpace)} free` : ""}
                </option>
              ))}
            </select>
          </label>

          {service === "radarr" ? (
            <label className={styles.field}>
              <span className={styles.label}>Minimum availability</span>
              <select
                className={controls.select}
                value={minimumAvailability}
                onChange={(e) => setMinimumAvailability(e.target.value as MinimumAvailability)}
              >
                {MINIMUM_AVAILABILITY.map((value) => (
                  <option key={value} value={value}>
                    {AVAILABILITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className={styles.field}>
              <span className={styles.label}>Monitor</span>
              <select
                className={controls.select}
                value={seriesMonitorMode}
                onChange={(e) => setSeriesMonitorMode(e.target.value as SeriesMonitorMode)}
              >
                {SERIES_MONITOR_MODES.map((value) => (
                  <option key={value} value={value}>
                    {MONITOR_MODE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className={styles.switchRow}>
            <span className={styles.label}>Monitored</span>
            <ToggleSwitch checked={monitor} onChange={setMonitor} size="sm" />
          </div>

          <div className={styles.switchRow}>
            <span className={styles.label}>
              Search on add
              <span className={styles.hint}>Ask the indexers for it straight away.</span>
            </span>
            <ToggleSwitch checked={searchOnAdd} onChange={setSearchOnAdd} size="sm" />
          </div>
        </div>
      )}
    </Modal>
  );
}

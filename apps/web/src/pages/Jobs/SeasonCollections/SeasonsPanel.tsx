/**
 * The season list: which holidays get a row, when, and which TMDb keywords
 * find their titles.
 *
 * Its own card rather than fields in the Configuration card, because the
 * generic form renders one control per key and this is a list of records,
 * each with a window and a keyword list. It saves only `seasons` and
 * `customSeasons` as a config patch, so it and the Configuration card can't
 * overwrite each other's settings.
 */
import { useEffect, useState } from "react";
import {
  describeMonthDayWindow,
  isMonthDayWindowActive,
  type ResolvedSeason,
  type SeasonsConfig,
} from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import CardSection from "#components/CardSection";
import MonthDaySelect from "#components/MonthDaySelect";
import ToggleSwitch from "#components/ToggleSwitch";
import UnsavedBanner from "#components/UnsavedBanner";
import { useToast } from "#components/Toast";
import useUnsavedChanges from "#hooks/useUnsavedChanges";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import controls from "#/styles/controls.module.css";
import shared from "#/styles/shared.module.css";
import jobs from "#pages/Jobs/Jobs.module.css";
import type { Job } from "#pages/Jobs/types";
import { customKey, draftDirty, draftFromConfig, patchFromDraft, presetFor, type SeasonDraft } from "./seasons-draft";
import styles from "./SeasonsPanel.module.css";

export default function SeasonsPanel({ job }: { job: Job }) {
  const stored = (job.config ?? {}) as SeasonsConfig;
  const storedKey = JSON.stringify({ seasons: stored.seasons, customSeasons: stored.customSeasons });
  const [draft, setDraft] = useState<SeasonDraft>(() => draftFromConfig(stored));
  const [serverError, setServerError] = useState<string>();
  const { addToast } = useToast();
  const utils = trpc.useUtils();

  // Reset when the saved config changes underneath — see JobSettingsPanel.
  useEffect(() => {
    setDraft(draftFromConfig(JSON.parse(storedKey)));
    setServerError(undefined);
  }, [storedKey]);

  const dirty = draftDirty(draft, stored);
  useUnsavedChanges(dirty);

  const mutation = trpc.jobs.update.useMutation({
    onSuccess: () => {
      utils.jobs.list.invalidate();
      addToast("Seasons saved", "success");
    },
    onError: (err) => {
      setServerError(err.message);
      addToast(err.message, "error");
    },
  });

  const update = (key: string, change: Partial<ResolvedSeason>) =>
    setDraft((d) => d.map((s) => (s.key === key ? { ...s, ...change } : s)));

  const addSeason = () =>
    setDraft((d) => [
      ...d,
      {
        key: customKey(
          "New season",
          d.map((s) => s.key),
        ),
        name: "New season",
        activeFrom: "01-01",
        activeTo: "01-07",
        keywords: [],
        enabled: true,
        custom: true,
      },
    ]);

  const today = new Date();

  return (
    <CardSection className={jobs.detailSection} titleClassName={jobs.detailSectionTitle} title="Seasons">
      <p className={jobs.fieldHelp}>
        Each season has a row while its dates are on, and none after. Titles are the ones TMDb files under its keywords.
      </p>
      <ul className={styles.list}>
        {draft.map((season) => {
          const preset = presetFor(season.key);
          const inSeason = season.enabled && isMonthDayWindowActive(season.activeFrom, season.activeTo, today);
          return (
            <li key={season.key} className={styles.season}>
              <div className={styles.head}>
                <ToggleSwitch
                  size="sm"
                  checked={season.enabled}
                  onChange={(enabled) => update(season.key, { enabled })}
                />
                <input
                  className={`${controls.input} ${controls.inputSm} ${styles.name}`}
                  value={season.name}
                  aria-label="Season name"
                  maxLength={60}
                  onChange={(e) => update(season.key, { name: e.target.value })}
                />
                {inSeason && <span className={shared.statusPill}>In season</span>}
                <span className={styles.spacer} />
                {preset ? (
                  <button
                    type="button"
                    className={`${controls.btn} ${controls.btnLink}`}
                    onClick={() => update(season.key, preset)}
                  >
                    Reset
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`${controls.btn} ${controls.btnLink}`}
                    onClick={() => setDraft((d) => d.filter((s) => s.key !== season.key))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className={styles.window}>
                <MonthDaySelect
                  label="From"
                  value={season.activeFrom}
                  onChange={(activeFrom) => update(season.key, { activeFrom })}
                />
                <span className={jobs.muted}>to</span>
                <MonthDaySelect
                  label="To"
                  value={season.activeTo}
                  onChange={(activeTo) => update(season.key, { activeTo })}
                />
                <span className={jobs.muted}>{describeMonthDayWindow(season.activeFrom, season.activeTo)}</span>
              </div>
              <div className={styles.keywords}>
                {season.keywords.map((k) => (
                  <span key={k.id} className={shared.label}>
                    {k.name}
                    <button
                      type="button"
                      className={shared.labelRemove}
                      aria-label={`Remove ${k.name}`}
                      onClick={() => update(season.key, { keywords: season.keywords.filter((x) => x.id !== k.id) })}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <KeywordPicker
                  taken={season.keywords.map((k) => k.id)}
                  onPick={(k) => update(season.key, { keywords: [...season.keywords, k] })}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {serverError && <p className={jobs.fieldHelpError}>{serverError}</p>}
      <div className={styles.footer}>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnSecondary} ${controls.btnSm}`}
          onClick={addSeason}
        >
          Add a season
        </button>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`}
          disabled={!dirty || mutation.isPending}
          onClick={() => {
            setServerError(undefined);
            mutation.mutate({ jobId: job.id, configPatch: patchFromDraft(draft) });
          }}
        >
          {mutation.isPending ? "Saving…" : "Save seasons"}
        </button>
        <UnsavedBanner visible={dirty} />
      </div>
    </CardSection>
  );
}

/** Search TMDb's keywords by name and add one. */
function KeywordPicker({ taken, onPick }: { taken: number[]; onPick: (k: { id: number; name: string }) => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 300);
  const search = trpc.jobs.seasonKeywordSearch.useQuery({ query: debounced }, { enabled: debounced.length >= 2 });
  const results = (search.data ?? []).filter((k) => !taken.includes(k.id)).slice(0, 8);
  return (
    <span className={styles.picker}>
      <input
        className={`${controls.input} ${controls.inputSm}`}
        value={query}
        placeholder="Add a keyword…"
        aria-label="Search TMDb keywords"
        onChange={(e) => setQuery(e.target.value)}
      />
      {debounced.length >= 2 && (
        <span className={styles.results}>
          {search.error ? (
            <span className={jobs.fieldHelpError}>{search.error.message}</span>
          ) : search.isLoading ? (
            <span className={jobs.muted}>Searching…</span>
          ) : results.length === 0 ? (
            <span className={jobs.muted}>No keywords match.</span>
          ) : (
            results.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                onClick={() => {
                  onPick(k);
                  setQuery("");
                }}
              >
                + {k.name}
              </button>
            ))
          )}
        </span>
      )}
    </span>
  );
}

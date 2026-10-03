import { useRef } from "react";
import styles from "#pages/Settings/Settings.module.css";
import local from "../SettingsMigrate.module.css";

/** A Kometa `file:` reference — collections defined outside the pasted file. */
const FILE_REF = /^\s*-?\s*file:/m;

export type SourceMode = "server" | "upload" | "scan";

interface SourceStepProps {
  mode: SourceMode;
  serverPath: string;
  pastedText: string;
  fileCount: number;
  error: string | null;
  onModeChange: (mode: SourceMode) => void;
  onServerPathChange: (value: string) => void;
  onPastedTextChange: (value: string) => void;
  onFilesPicked: (files: FileList) => void;
}

/**
 * Where the Kometa config comes from.
 *
 * The server-path option is first because it's the only one that's genuinely
 * one click: Kometa and Tinkerbell are usually the same box with the same
 * volume mounts, so `/config` is already right there. Uploading is the fallback
 * for split setups, and pasting covers the large group of people whose entire
 * config is forty lines of `default:` entries.
 *
 * The third option — "I don't have it" — matters more than it looks. Plenty of
 * people ran a defaults setup from a guide years ago and no longer have the
 * file. Sending them to the collection scanner is a worse migration but a much
 * better outcome than a dead end.
 */
export default function SourceStep({
  mode,
  serverPath,
  pastedText,
  fileCount,
  error,
  onModeChange,
  onServerPathChange,
  onPastedTextChange,
  onFilesPicked,
}: SourceStepProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dirRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className={styles.form}>
      <div className={local.choiceGrid}>
        <button
          type="button"
          className={`${local.choiceCard} ${mode === "server" ? local.choiceCardActive : ""}`}
          onClick={() => onModeChange("server")}
        >
          <strong>Read it from this server</strong>
          <span>If Kometa runs on the same machine, point at its config folder.</span>
        </button>
        <button
          type="button"
          className={`${local.choiceCard} ${mode === "upload" ? local.choiceCardActive : ""}`}
          onClick={() => onModeChange("upload")}
        >
          <strong>Upload my config</strong>
          <span>Pick your Kometa config folder, or paste a single config.yml.</span>
        </button>
        <button
          type="button"
          className={`${local.choiceCard} ${mode === "scan" ? local.choiceCardActive : ""}`}
          onClick={() => onModeChange("scan")}
        >
          <strong>I don't have my config</strong>
          <span>Work it out from the collections Kometa left in Plex instead.</span>
        </button>
      </div>

      {mode === "server" && (
        <div className={styles.field}>
          <label htmlFor="kometa-server-path">Path to your Kometa config</label>
          <input
            id="kometa-server-path"
            className={local.input}
            value={serverPath}
            onChange={(e) => onServerPathChange(e.target.value)}
            placeholder="/config"
            spellCheck={false}
          />
          <p className={styles.hint}>The folder, or config.yml itself.</p>
        </div>
      )}

      {mode === "upload" && (
        <>
          <div className={styles.field}>
            <div className={styles.buttons}>
              {/*
                Two pickers rather than one, because browsers make you choose:
                `webkitdirectory` gives the whole config folder in one go — which
                is what preserves the relative paths Kometa's own `file:`
                references are written against — but it can't also select loose
                files.
              */}
              <button type="button" className={styles.buttonSecondary} onClick={() => dirRef.current?.click()}>
                Choose config folder…
              </button>
              <button type="button" className={styles.buttonSecondary} onClick={() => fileRef.current?.click()}>
                Choose files…
              </button>
            </div>
            {fileCount > 0 && (
              <p className={styles.hint}>
                {fileCount} YAML file{fileCount === 1 ? "" : "s"} ready.
              </p>
            )}
            <input
              ref={dirRef}
              type="file"
              hidden
              multiple
              // Not in the React types; it's the only way to pick a directory.
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => {
                if (e.target.files?.length) onFilesPicked(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept=".yml,.yaml"
              onChange={(e) => {
                if (e.target.files?.length) onFilesPicked(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="kometa-paste">…or paste your config.yml</label>
            <textarea
              id="kometa-paste"
              className={local.textarea}
              rows={10}
              value={pastedText}
              onChange={(e) => onPastedTextChange(e.target.value)}
              placeholder={"libraries:\n  Movies:\n    collection_files:\n      - default: genre"}
              spellCheck={false}
            />
            {/* Only once the paste actually points elsewhere: until then the
                caveat is about a problem this config doesn't have. */}
            {FILE_REF.test(pastedText) && (
              <p className={styles.hint}>This config references other files — use the folder picker to include them.</p>
            )}
          </div>
        </>
      )}

      {mode === "scan" && (
        <p className={styles.hint}>Rougher: filters, limits and ordering aren&apos;t visible from Plex.</p>
      )}

      {error && (
        <p className={`${styles.hint} ${local.errorHint}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

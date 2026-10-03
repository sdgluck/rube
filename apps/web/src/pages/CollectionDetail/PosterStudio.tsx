import { useState, useRef } from "react";
import { POSTER_URL_ALLOWED_HOSTS } from "@tinkerbell/contracts";
import { trpc } from "#/trpc";
import ColorField from "#components/ColorField";
import Modal from "#components/Modal";
import { useDebouncedValue } from "#hooks/useDebouncedValue";
import { useToast } from "#components/Toast";
import styles from "#/styles/shared.module.css";
import { uploadCollectionPoster } from "./upload.ts";
import local from "./CollectionDetail.module.css";

const SOURCES = ["generate", "upload", "plex", "url"] as const;
type Source = (typeof SOURCES)[number];

const SOURCE_LABELS: Record<Source, string> = {
  generate: "Generate",
  upload: "Upload",
  plex: "From Plex",
  url: "From a URL",
};

const TEMPLATES = [
  { id: "gradient", label: "Gradient", help: "The title set large over a colour drawn from the members." },
  { id: "mosaic", label: "Mosaic", help: "A grid of member posters, darkened, with the title over it." },
  { id: "spotlight", label: "Spotlight", help: "One member poster, framed, with the title beneath." },
] as const;

/**
 * Choosing a collection's poster, from any of the four places one can come
 * from.
 *
 * The preview is server-rendered by the same code that would do the upload —
 * a browser-drawn approximation would be a preview of a different image. And
 * there is no palette swatch beside it, deliberately: the image is the palette.
 */
export default function PosterStudio({
  ratingKey,
  title,
  memberCount,
  onClose,
  onApplied,
}: {
  ratingKey: string;
  title: string;
  /**
   * How many members the collection has — only to warn that the templates
   * will have no art to draw on. The render itself reads the members server
   * side, so the keys never need to make the round trip.
   */
  memberCount: number;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { addToast } = useToast();

  const [source, setSource] = useState<Source>("generate");
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]["id"]>("mosaic");
  const [accent, setAccent] = useState("");
  const [url, setUrl] = useState("");
  const [candidateKey, setCandidateKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const candidatesQuery = trpc.collections.posterCandidates.useQuery(
    { ratingKey },
    { enabled: source === "plex", refetchOnWindowFocus: false },
  );

  const applyGenerated = trpc.collections.applyGeneratedPoster.useMutation();
  const applyUrl = trpc.collections.setPosterUrl.useMutation();
  const applySelected = trpc.collections.selectPoster.useMutation();
  const markUploaded = trpc.collections.posterUploaded.useMutation();

  // Debounced rather than fired by a button: the point of the picker is that
  // changing the template changes the picture. Dragging the colour picker
  // fires a change per frame and a render is real work on the server, so it
  // doesn't trigger one per movement.
  const debouncedAccent = useDebouncedValue(accent, 350);
  const previewQuery = trpc.collections.previewGeneratedPoster.useQuery(
    { ratingKey, poster: template, accentColor: debouncedAccent || undefined },
    { enabled: source === "generate", refetchOnWindowFocus: false },
  );
  const previewUrl = previewQuery.data?.dataUrl ?? null;
  const previewError = previewQuery.error?.message ?? null;

  const done = (message: string) => {
    addToast(message, "success");
    onApplied();
  };

  const fail = (err: unknown, fallback: string) => {
    addToast(err instanceof Error ? err.message : fallback, "error");
  };

  const handleApply = async () => {
    setBusy(true);
    try {
      if (source === "generate") {
        await applyGenerated.mutateAsync({ ratingKey, poster: template, accentColor: accent || undefined });
        done("Poster generated and uploaded to Plex");
      } else if (source === "url") {
        await applyUrl.mutateAsync({ ratingKey, url: url.trim() });
        done("Poster set from the URL");
      } else if (source === "plex" && candidateKey) {
        await applySelected.mutateAsync({ ratingKey, posterKey: candidateKey });
        done("Poster selected");
      }
    } catch (err) {
      fail(err, "Failed to set the poster");
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setProgress(0);
    try {
      await uploadCollectionPoster(ratingKey, file, setProgress);
      // The upload route writes to Plex; this records that a person chose it,
      // so no job overwrites it tonight.
      await markUploaded.mutateAsync({ ratingKey });
      done("Poster uploaded to Plex");
    } catch (err) {
      fail(err, "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const canApply =
    !busy &&
    ((source === "generate" && !!previewUrl) ||
      (source === "url" && url.trim().length > 0) ||
      (source === "plex" && !!candidateKey));

  return (
    <Modal
      open
      onClose={onClose}
      title="Collection poster"
      meta={title}
      size="lg"
      footer={
        <>
          <button className={styles.buttonSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {source !== "upload" && (
            <button className={styles.button} onClick={handleApply} disabled={!canApply}>
              {busy ? "Applying…" : "Apply to Plex"}
            </button>
          )}
        </>
      }
    >
      <div className={styles.viewToggle} role="tablist" aria-label="Poster source">
        {SOURCES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={source === s}
            className={`${styles.viewToggleBtn} ${source === s ? styles.viewToggleBtnActive : ""}`}
            onClick={() => setSource(s)}
          >
            {SOURCE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className={local.studio}>
        <div>
          {source === "generate" && previewError ? (
            <div className={local.studioPlaceholder}>{previewError}</div>
          ) : source === "generate" && previewUrl ? (
            <img className={local.studioPreview} src={previewUrl} alt={`Poster preview for "${title}"`} />
          ) : source === "generate" ? (
            <div className={local.studioPlaceholder}>Rendering…</div>
          ) : (
            <div className={local.studioPlaceholder}>
              {source === "upload" ? "Cropped to 1000×1500" : source === "plex" ? "Pick a poster" : "Paste a URL"}
            </div>
          )}
        </div>

        <div className={local.studioPane}>
          {source === "generate" && (
            <>
              <div className={local.choiceList}>
                {TEMPLATES.map((t) => (
                  <label key={t.id} className={local.choice}>
                    <input
                      type="radio"
                      name="poster-template"
                      checked={template === t.id}
                      onChange={() => setTemplate(t.id)}
                    />
                    <span>
                      {t.label}
                      <span className={local.settingHelp}>{t.help}</span>
                    </span>
                  </label>
                ))}
              </div>
              <label className={styles.fieldLabel} htmlFor="poster-accent">
                Accent colour
              </label>
              <ColorField
                id="poster-accent"
                value={accent}
                onChange={setAccent}
                autoTitle="Taken from the member art"
              />
              {memberCount === 0 && <p className={styles.hint}>No members yet, so templates render plainly.</p>}
            </>
          )}

          {source === "upload" && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className={local.dropZone}
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                {progress !== null
                  ? `Uploading… ${Math.round(progress * 100)}%`
                  : "Choose an image — JPEG, PNG, WebP or AVIF, up to 8 MB"}
              </button>
              <p className={styles.hint}>No job will replace an uploaded poster.</p>
            </>
          )}

          {source === "plex" && (
            <>
              {candidatesQuery.isLoading ? (
                <p className={styles.hint}>Asking Plex…</p>
              ) : (candidatesQuery.data?.length ?? 0) === 0 ? (
                <p className={styles.hint}>Plex has no other posters stored for this collection.</p>
              ) : (
                <div className={local.candidateRow}>
                  {candidatesQuery.data?.map((candidate) => (
                    <button
                      key={candidate.key}
                      type="button"
                      className={`${local.candidate} ${candidateKey === candidate.key ? local.candidateSelected : ""}`}
                      onClick={() => setCandidateKey(candidate.key)}
                      aria-label={candidate.selected ? "Current poster" : "Poster option"}
                    >
                      <img
                        className={local.candidateImg}
                        src={`/api/plex-image?path=${encodeURIComponent(candidate.key)}`}
                        alt=""
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {source === "url" && (
            <>
              <label className={styles.fieldLabel} htmlFor="poster-url">
                Image URL
              </label>
              <input
                id="poster-url"
                className={styles.input}
                placeholder="https://image.tmdb.org/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                spellCheck={false}
              />
              {/* The allowlist is enforced on the server; naming it here means
                  a rejected URL is a thing you can avoid rather than discover. */}
              <p className={styles.hint}>HTTPS, from {POSTER_URL_ALLOWED_HOSTS.join(", ")}</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

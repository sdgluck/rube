import { useEffect, useState } from "react";
import type { PresentationConfig } from "@rube/contracts";
import { trpc } from "#/trpc";
import styles from "./CollectionPosterPreview.module.css";

interface CollectionPosterPreviewProps {
  title: string;
  presentation: PresentationConfig;
  /** Library to sample member art from. Absent means any synced library. */
  sectionId?: string | null;
  sectionType?: string;
  ruleType?: string;
  /** False parks the preview without firing a render (invalid input, disabled). */
  enabled?: boolean;
}

/**
 * The generated poster, rendered by the server with the same code the job
 * uses.
 *
 * Nobody switches on something that writes to their Plex server without seeing
 * it first, and a preview drawn a second way in the browser would be a preview
 * of a different image. There is deliberately no palette swatch beside it: the
 * image *is* the palette.
 */
export default function CollectionPosterPreview({
  title,
  presentation,
  sectionId,
  sectionType,
  ruleType,
  enabled = true,
}: CollectionPosterPreviewProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const render = trpc.posters.previewCollectionPoster.useMutation();
  const { mutateAsync } = render;

  // Keyed on the inputs rather than on a button: the whole point is that
  // changing the template updates the picture. Debounced, because the accent
  // field is a text input and a render is real work on the server.
  const key = JSON.stringify({ title, presentation, sectionId, sectionType, ruleType, enabled });
  useEffect(() => {
    if (!enabled || presentation.poster === "none" || !title.trim()) {
      setDataUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      mutateAsync({
        presentation,
        title: title.slice(0, 200),
        sectionId: sectionId ?? undefined,
        sectionType,
        ruleType,
      })
        .then((result) => {
          if (cancelled) return;
          setDataUrl(result.dataUrl);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setDataUrl(null);
          setError(err instanceof Error ? err.message : "Preview failed");
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mutateAsync]);

  if (!enabled || presentation.poster === "none") {
    return <p className={styles.placeholder}>No artwork — collections keep whatever poster Plex gives them.</p>;
  }
  if (error) return <p className={styles.error}>{error}</p>;
  if (!dataUrl) return <div className={styles.skeleton} aria-label="Rendering preview" />;

  return <img className={styles.poster} src={dataUrl} alt={`Poster preview for "${title}"`} />;
}

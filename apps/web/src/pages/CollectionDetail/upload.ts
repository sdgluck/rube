/**
 * Uploading a collection poster.
 *
 * `XMLHttpRequest` rather than `fetch` for the same reason the preroll upload
 * uses it: fetch still can't report upload progress. A poster is smaller than a
 * preroll, but on a slow connection a few megabytes with no feedback still
 * looks like a hung dialog.
 */

export function uploadCollectionPoster(
  ratingKey: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/collections/${encodeURIComponent(ratingKey)}/poster`);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    });

    xhr.addEventListener("load", () => {
      const body = xhr.response as { ok?: boolean; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok) {
        resolve();
        return;
      }
      reject(new Error(body?.error || `Upload failed (${xhr.status})`));
    });

    xhr.addEventListener("error", () => reject(new Error("Upload failed — the connection dropped")));

    // The body is the raw file: the server reads it straight into a buffer, so
    // there is no multipart envelope to build or parse.
    xhr.send(file);
  });
}

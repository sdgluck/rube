/**
 * Uploading a preroll.
 *
 * `XMLHttpRequest` rather than `fetch` for one reason: fetch still can't
 * report upload progress, and a multi-hundred-megabyte file with no feedback
 * looks indistinguishable from a hung page.
 */

import { apiUrl, authHeaders } from "@tinkerbell/native-client";

export type UploadHandlers = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

export function uploadPreroll(file: File, handlers: UploadHandlers = {}): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ filename: file.name, name: stripExtension(file.name) });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(`/api/prerolls/upload?${params}`));
    // The native app's session; the browser's rides along as the cookie.
    for (const [name, value] of Object.entries(authHeaders())) xhr.setRequestHeader(name, value);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) handlers.onProgress?.(event.loaded / event.total);
    });

    xhr.addEventListener("load", () => {
      const body = xhr.response as { id?: string; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.id) {
        resolve({ id: body.id });
        return;
      }
      reject(new Error(body?.error || `Upload failed (${xhr.status})`));
    });

    xhr.addEventListener("error", () => reject(new Error("Upload failed — the connection dropped")));
    xhr.addEventListener("abort", () => reject(new DOMException("Upload cancelled", "AbortError")));

    handlers.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    // The body is the raw file. The server streams it straight to disk, so
    // there's no multipart envelope to build or parse.
    xhr.send(file);
  });
}

export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

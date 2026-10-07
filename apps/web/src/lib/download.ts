/**
 * Downloading a file the server generates (an export bundle, a backup).
 *
 * In the browser it stays a plain navigation: the server's
 * `Content-Disposition` names the file, and the download streams with the
 * browser's own progress, which a multi-megabyte backup deserves. In the
 * native app a navigation to an attachment does nothing at all, so the file is
 * fetched with the bearer token and handed to the share sheet instead.
 */
import { apiUrl, authHeaders, isNative, saveFile } from "@tinkerbell/native-client";

export async function downloadFromServer(path: string, fallbackName: string): Promise<void> {
  if (!isNative()) {
    window.location.href = path;
    return;
  }
  const res = await fetch(apiUrl(path), { headers: authHeaders(), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  await saveFile(await res.blob(), filenameFrom(res.headers.get("content-disposition")) ?? fallbackName);
}

/** `attachment; filename="tinkerbell-export.json"` → `tinkerbell-export.json`. */
export function filenameFrom(disposition: string | null): string | null {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

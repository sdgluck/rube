/**
 * Saving a file the page generated (a run log, an overlay or rule export).
 *
 * A blob URL clicked through an `<a download>` — the one way to name a file
 * that never came from the server. Files the server generates (export bundles,
 * backups) don't come through here: they stay a plain navigation, so the
 * server's `Content-Disposition` names the file and a multi-megabyte backup
 * streams with the browser's own progress.
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // In the document for the click, as older Firefox requires.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: Safari cancels a download whose URL is revoked
  // synchronously after the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

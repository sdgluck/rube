/**
 * "Download this file", in a browser and in the app.
 *
 * A WebView has no downloads folder: an `<a download>` click or a
 * `location.href` to an attachment does nothing at all there, silently. So in
 * the app the file is written to the cache directory and handed to the share
 * sheet, which is where "save to Files", AirDrop and mail all live on a phone.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
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
    return;
  }
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  await Share.share({ title: filename, files: [uri] });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    // `data:<type>;base64,<payload>` — Filesystem wants only the payload.
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

/** Open a link outside the app: the in-app browser natively, a new tab in a browser. */
export async function openExternal(url: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
}

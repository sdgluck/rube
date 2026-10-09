import { saveFile } from "@tinkerbell/native-client";
/** A download in the browser, the share sheet in the app — see `saveFile`. */
export function downloadJson(data: unknown, filename: string): Promise<void> {
  return saveFile(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
}

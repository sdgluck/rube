import { saveFile } from "#lib/download";

export function downloadJson(data: unknown, filename: string): void {
  saveFile(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
}

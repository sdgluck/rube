export interface AiCollection {
  name: string;
  items: string[];
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f]", "g");

/**
 * Parse Claude's collection list. Tries strict JSON first, then falls back
 * to extracting the bracketed array, then to a cleaned variant (trailing
 * commas, control chars). Throws if all attempts fail so the caller sees
 * the raw text in logs.
 */
export function parseAiCollections(text: string): AiCollection[] {
  try {
    return JSON.parse(text) as AiCollection[];
  } catch {}

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]) as AiCollection[];
    } catch {}

    const cleaned = match[0].replace(/,\s*([}\]])/g, "$1").replace(CONTROL_CHARS, " ");
    try {
      return JSON.parse(cleaned) as AiCollection[];
    } catch {}
  }

  throw new Error(`Failed to parse AI response as JSON:\n${text}`);
}

/**
 * The admin UI's interface-size steps, as multipliers of the designed size.
 *
 * A fixed list rather than a free number: each step is a size someone has
 * looked at, and a slider stored as 0.8734 is a size nobody has. Shared here
 * because the server refuses anything off the list on save and the browser
 * renders the choices from the same array — two copies would let the picker
 * offer a step the server rejects.
 *
 * Below ~0.85 the 9.5px labels fall under 8px; above 1.2 a 1440px laptop is
 * back to the cramped layout the smaller steps exist to fix.
 */
export const UI_SCALES = [0.85, 0.9, 1, 1.1, 1.2] as const;
export type UiScale = (typeof UI_SCALES)[number];
export const DEFAULT_UI_SCALE: UiScale = 1;

export function isUiScale(value: unknown): value is UiScale {
  return (UI_SCALES as readonly unknown[]).includes(value);
}

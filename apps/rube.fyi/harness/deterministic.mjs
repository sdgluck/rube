/**
 * Pins the two sources of run-to-run variance inside a server process.
 * Preloaded with `node --import`.
 *
 * The browser-side equivalents (`page.clock.setFixedTime`, a seeded
 * `Math.random` init script) only reach the page. Plenty of what ends up
 * rendered is decided on the server:
 *
 *   - `/stats` shows uptime derived from the server's own start time.
 *   - `overlays.sampleItem` picks the poster to preview with `Math.random()`.
 *
 * Timers are deliberately left alone. Replacing `setTimeout`/`setInterval`
 * would stall the job runner and every `AbortSignal.timeout`, and the point
 * here is only to pin what gets *rendered*, not to control scheduling.
 */

const FIXED = Number(process.env.TB_FIXED_NOW);
if (!Number.isFinite(FIXED)) {
  throw new Error("deterministic: TB_FIXED_NOW must be set to an epoch in milliseconds");
}

// ── Math.random ─────────────────────────────────────────────────────────────
// mulberry32, seeded from the fixed instant so the sequence is the same on
// every run but isn't a constant.
let seed = FIXED >>> 0;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ── Date ────────────────────────────────────────────────────────────────────
const RealDate = Date;

class FrozenDate extends RealDate {
  constructor(...args) {
    // `new Date()` means "now", which is frozen. Every other signature is an
    // explicit instant and must be left exactly as the caller wrote it.
    super(...(args.length === 0 ? [FIXED] : args));
  }

  static now() {
    return FIXED;
  }
}

FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;

globalThis.Date = FrozenDate;

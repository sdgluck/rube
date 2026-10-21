/**
 * Reads the recommender model file that `ml/` publishes (see `ml/recs/export.py`
 * for the layout, and `models/recs.json` for which version this source expects).
 *
 * Typed-array views over one buffer rather than a parse into objects: the file
 * holds ~350k vectors, and dequantising them all up front would be ~90MB of
 * Float32 for a job that reads a few thousand. Vectors are dequantised one row
 * at a time, on demand.
 *
 * An unknown `format` is refused rather than read with today's assumptions —
 * the same rule the rule registry applies to its index.
 */
const MAGIC = "TBRV";
export const SUPPORTED_FORMAT = 1;

export interface ModelHeader {
  format: number;
  version: number;
  dims: number;
  count: number;
  keysBytes: number;
  regularization: number;
  alpha: number;
  foldInScale: number;
  sources: { collaborative: number; content: number };
  license: string;
  attribution: string;
}

export interface Model {
  header: ModelHeader;
  /** `movie:550` / `tv:1399` → row. */
  rows: Map<string, number>;
  /** YᵀY, row-major `dims × dims`. */
  gram: Float64Array;
  /** Writes row `i`'s dequantised vector into `out` and returns it. */
  vector(i: number, out?: Float64Array): Float64Array;
}

const pad8 = (n: number) => n + ((8 - (n % 8)) % 8);

export function parseModel(buf: Uint8Array): Model {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const text = new TextDecoder();
  if (text.decode(buf.subarray(0, 4)) !== MAGIC) throw new Error("not a recommender model file");
  const headerLength = view.getUint32(4, true);
  let off = 8;
  const header = JSON.parse(text.decode(buf.subarray(off, off + headerLength))) as ModelHeader;
  if (header.format !== SUPPORTED_FORMAT) {
    throw new Error(`recommender model format ${header.format} isn't supported by this version of Rube`);
  }
  off += headerLength;

  const { dims, count, keysBytes } = header;
  const keys = text.decode(buf.subarray(off, off + keysBytes)).split("\n");
  if (keys.length !== count) throw new Error(`recommender model lists ${keys.length} keys for ${count} vectors`);
  off += pad8(keysBytes);

  // Copies for the float arrays: a typed-array view needs its offset aligned
  // to the element size, and a Node Buffer's byteOffset into its pool is not
  // guaranteed to be. `copy`, not `slice` — on a Buffer, `slice` is a view,
  // and its `.buffer` is the whole pool.
  const copy = (start: number, end: number) => new Uint8Array(buf.subarray(start, end)).buffer;
  const gram = new Float64Array(copy(off, off + dims * dims * 8));
  off += dims * dims * 8;
  const scale = new Float32Array(copy(off, off + count * 4));
  off += pad8(count * 4);
  off += pad8(count); // the source column: diagnostics only, unused at runtime
  if (off + count * dims > buf.byteLength) throw new Error("recommender model file is truncated");
  const q = new Int8Array(buf.buffer, buf.byteOffset + off, count * dims);

  const rows = new Map<string, number>();
  for (let i = 0; i < count; i++) rows.set(keys[i]!, i);

  return {
    header,
    rows,
    gram,
    vector(i, out = new Float64Array(dims)) {
      const s = scale[i]!;
      const base = i * dims;
      for (let d = 0; d < dims; d++) out[d] = q[base + d]! * s;
      return out;
    },
  };
}

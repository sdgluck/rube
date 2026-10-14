/**
 * The one linear solve fold-in needs, in plain TypeScript.
 *
 * The system is 64×64 and symmetric positive definite (YᵀY plus a ridge), so
 * Cholesky is exact enough and well under a millisecond — not worth a numeric
 * dependency in an image whose size is watched closely.
 */

/** Solves `a · x = b` for SPD `a` (row-major `n × n`). `a` is not modified. */
export function solveSpd(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= l[i * n + k]! * l[j * n + k]!;
      if (i === j) {
        if (sum <= 0) throw new Error("fold-in system is not positive definite");
        l[i * n + i] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / l[j * n + j]!;
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= l[i * n + k]! * y[k]!;
    y[i] = sum / l[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i]! * x[k]!;
    x[i] = sum / l[i * n + i]!;
  }
  return x;
}

export function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function norm(a: Float64Array): number {
  return Math.sqrt(dot(a, a));
}

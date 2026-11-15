// KAN-6. Text gzip barely shrinks (6 bits of entropy per char), for "too large even compressed" fixtures.
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function incompressible(length: number, seed = 1): string {
  let state = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    // xorshift32: deterministic, so sizes stay stable across runs.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out += ALPHABET[(state >>> 0) & 63];
  }
  return out;
}

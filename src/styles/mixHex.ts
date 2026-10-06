// `top` over `bottom` at `topWeight` (0 to 1), as #RRGGBB, each channel rounded.
export function mixHex(top: string, bottom: string, topWeight: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const over = channels(top);
  const under = channels(bottom);
  const mixed = over.map((value, i) =>
    Math.round(value * topWeight + under[i] * (1 - topWeight))
  );
  return `#${mixed
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

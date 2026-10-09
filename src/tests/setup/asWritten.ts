/** A colour as emotion writes it, or as jsdom normalises it. */
export function asWritten(hex: string): RegExp {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
}

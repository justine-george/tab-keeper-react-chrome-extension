import { channels } from './hexColor';

/** A colour as emotion writes it, or as jsdom normalises it. */
export function asWritten(hex: string): RegExp {
  const [r, g, b] = channels(hex);
  return new RegExp(`(${hex}|rgb\\(${r}, ?${g}, ?${b}\\))`, 'i');
}

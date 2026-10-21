/** A `#RRGGBB` colour as its three 0-255 channels. Throws on any other form. */
export function channels(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Not a #RRGGBB colour: ${JSON.stringify(hex)}`);
  }
  const at = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [at(1), at(3), at(5)];
}

/** A `#RRGGBB` colour as getComputedStyle spells it. */
export function rgb(hex: string): string {
  return `rgb(${channels(hex).join(', ')})`;
}

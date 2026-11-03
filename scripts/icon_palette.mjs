// KAN-907. The icon files' colours, and the mark's markup recoloured with them.
// The mark is drawn in a desaturated table; the icons keep their own brighter one and an opaque ground.
export const ICON_FILL = {
  '#99bf9d': '#87c68e',
  '#445562': '#3a576d',
  '#253038': '#1f313e',
  '#f4eae2': '#f9e9db',
  '#222636': '#202842',
  '#20292e': '#1b2a33',
  '#d09263': '#f28c3d',
};

// TabKeeperMark's markup, unstyled, every fill swapped for its icon colour.
export function iconSvg(markup) {
  const svg = markup.match(/<svg[\s\S]*<\/svg>/)?.[0];
  if (!svg) throw new Error('TabKeeperMark rendered no <svg>');
  const out = svg
    .replace(/ class="[^"]*"/, '')
    .replace(/ fill-opacity="[^"]*"/, '');
  return out.replace(/fill="(#[0-9a-f]{6})"/g, (_, hex) => {
    const to = ICON_FILL[hex];
    if (!to) throw new Error(`no icon colour for ${hex}`);
    return `fill="${to}"`;
  });
}

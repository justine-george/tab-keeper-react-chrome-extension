// KAN-321. The tab view's third grid track (Open now's column), resolved to
// the width it is drawn at.
//
// MainContainer writes that track as var(--open-now-width) and sets the
// property on the grid element itself, so a width change touches no Emotion
// class. jsdom does not substitute var() in a computed grid-template-columns,
// so this resolves it by hand from the same element: the value a browser
// would substitute. A var() with no value set throws, rather than passing as
// an empty string.
export function openNowTrack(): string {
  const pane = document.querySelector<HTMLElement>('[data-pane="open-now"]');
  if (pane === null) throw new Error('no open-now pane');
  const grid = pane.parentElement;
  if (grid === null) throw new Error('open-now pane has no parent');
  const style = getComputedStyle(grid);
  const tracks = style.gridTemplateColumns.split(' ');
  const last = tracks[tracks.length - 1];
  const variable = /^var\((--[\w-]+)\)$/.exec(last);
  if (variable === null) return last;
  const value = style.getPropertyValue(variable[1]).trim();
  if (value === '') throw new Error(`${variable[1]} is not set on the grid`);
  return value;
}

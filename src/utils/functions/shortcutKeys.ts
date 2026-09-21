/**
 * The keys of a binding as Chrome reports it, one per keycap (KAN-256).
 *
 * chrome.commands.getAll() gives one string whose shape depends on the
 * platform: "Alt+Shift+K" on Windows and Linux, "⌥⇧K" on a Mac -- each
 * modifier a single glyph with no separator. A split on "+" alone would
 * render the Mac form as one cap reading "⌥⇧K".
 *
 * So: split on "+" where there is one; otherwise peel single-glyph
 * modifiers off the front and keep whatever remains together, so "⌘F1" is
 * ["⌘", "F1"] and a media key stays one cap.
 */
const MAC_MODIFIER_GLYPHS = new Set(['⌘', '⌥', '⇧', '⌃']);

export function shortcutKeys(binding: string): string[] {
  if (binding === '') return [];
  if (binding.includes('+')) return binding.split('+');

  const keys: string[] = [];
  let rest = Array.from(binding);
  while (rest.length > 1 && MAC_MODIFIER_GLYPHS.has(rest[0])) {
    keys.push(rest[0]);
    rest = rest.slice(1);
  }
  keys.push(rest.join(''));
  return keys;
}

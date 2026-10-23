// KAN-752. The one rule for every sort by name: case and accents ignored, numbers read as numbers (Trip 2 before Trip 10), in the UI language.
export function nameCollator(locale: string): Intl.Collator {
  return new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
}

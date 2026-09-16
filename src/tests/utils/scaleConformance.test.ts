import { describe, expect, test } from 'vitest';

import { TYPE, RADIUS, DURATION } from '../../styles/scale';

// KAN-205. The scales in styles/scale.ts are only worth having if something
// obliges the components to use them -- otherwise they become one more set of
// values in a codebase that already had fifteen font sizes.
//
// This walks the component sources and fails on any literal that is not on a
// scale. It is deliberately a source scan rather than a rendered assertion: the
// defect is not "this component looks wrong", it is "this value exists at all",
// and only reading the source can say that.
//
// Adding a value to a scale is a design decision and shows up as a diff to
// scale.ts. Adding one to a component now shows up as a failure here, which is
// the whole mechanism.

/**
 * The component sources, read as text.
 *
 * `?raw` through Vite rather than node:fs, which the src tsconfig has no types
 * for -- and which dragStyles.test.ts already established as how a test in here
 * reads a file. `eager` because the whole set is needed before the first
 * assertion, not lazily per test.
 */
const SOURCES = import.meta.glob('../../components/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * The export page is out of scope for now, by decision, not by oversight.
 *
 * It is frozen while its output is being relied on, and it is the only surface
 * mixing px with rem. When it is opened up this entry comes off and the same
 * scales apply to it.
 */
const EXCLUDED = ['/components/export/'];

/**
 * Values that are off the scale ON PURPOSE, with the reason recorded where they
 * are declared. One entry, and it should stay that way -- an exemption list is
 * how a five-step scale becomes a fifteen-step one.
 *
 * 0.85rem is the Chrome group title (WindowEntryContainer's GROUP_TITLE_SIZE).
 * The window title and the tab titles are both TYPE.BODY, so a group sits
 * between them by design; it was compared in a browser before being chosen, and
 * flattening it to BODY would make a group read as prominent as the window
 * holding it.
 */
const EXEMPT = ['0.85rem'];

/** Source with its comments stripped, so prose cannot trip the scan. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const FILES = Object.entries(SOURCES)
  .filter(([path]) => !EXCLUDED.some((dir) => path.includes(dir)))
  .map(([path, src]) => ({
    name: path.slice(path.indexOf('components/')),
    code: stripComments(src),
  }));

/**
 * Sizes passed as a PROP rather than written as CSS: `size="0.9rem"`.
 *
 * Added after the first pass missed the Chrome group title entirely, which is
 * declared this way -- a scan that only reads CSS has a blind spot exactly where
 * a shared Label component is used, which is most of the app.
 */
function sizeProps(src: string): string[] {
  return [...src.matchAll(/\bsize=\{?["'`]([0-9.]+rem)["'`]\}?/g)].map(
    (m) => m[1]
  );
}

/** Every literal value of `prop` in one file, with interpolations dropped. */
function literals(src: string, prop: string): string[] {
  const found = [...src.matchAll(new RegExp(`${prop}:\\s*([^;\\n]+)`, 'g'))]
    .map((m) => m[1].trim())
    // A value built from a variable is this scan's blind spot and is meant to
    // be: it is the scale reaching the component, which is the goal.
    .filter((v) => !v.includes('${') && !v.startsWith('$'))
    // CSS keywords are not scale choices: `inherit` explicitly defers to
    // whatever the scale already set on an ancestor, which is conformance
    // rather than a violation of it.
    .filter((v) => !['inherit', 'unset', 'initial', 'revert'].includes(v));
  return found;
}

describe('components take their sizes from the shared scales (KAN-205)', () => {
  const allowed = {
    'font-size': Object.values(TYPE) as string[],
    'border-radius': Object.values(RADIUS) as string[],
  };

  for (const [prop, values] of Object.entries(allowed)) {
    test(`every ${prop} is on the scale`, () => {
      const offenders: string[] = [];
      for (const file of FILES) {
        const found =
          prop === 'font-size'
            ? [...literals(file.code, prop), ...sizeProps(file.code)]
            : literals(file.code, prop);
        for (const value of found) {
          if (!values.includes(value) && !EXEMPT.includes(value)) {
            offenders.push(`${file.name}: ${value}`);
          }
        }
      }
      expect(
        offenders,
        `these are not on the ${prop} scale (styles/scale.ts):\n` +
          offenders.join('\n')
      ).toEqual([]);
    });
  }

  test('every transition duration is one of the two named ones', () => {
    const named = Object.values(DURATION) as string[];
    // Both spellings, because CSS accepts either and the codebase used both.
    const equivalent = named.flatMap((d) => [
      d,
      `${Number.parseInt(d) / 1000}s`,
    ]);
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const [, value] of file.code.matchAll(
        /transition[^;\n]*?\s([0-9.]+m?s)/g
      )) {
        if (!equivalent.includes(value))
          offenders.push(`${file.name}: ${value}`);
      }
    }
    expect(
      offenders,
      `these durations are not DURATION.COLOR or DURATION.MOVE:\n` +
        offenders.join('\n')
    ).toEqual([]);
  });

  // Decision: the popup keeps ONE font weight. Hierarchy there is carried by
  // size and colour tier, and it works -- a bold title was tried and read as
  // arbitrary emphasis precisely because it was the only bold text in the pane.
  // Modals are allowed 500 on their own title, which predates this and is a
  // self-contained surface.
  test('the popup declares no font weight', () => {
    const offenders = FILES.filter(
      (f) => !f.name.includes('components/modals/')
    ).flatMap((f) =>
      literals(f.code, 'font-weight').map((v) => `${f.name}: ${v}`)
    );
    expect(
      offenders,
      'hierarchy in the popup is size and colour tier, not weight:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  // The controls people actually click are on the 32px row unit. Asserted by
  // naming them rather than by scanning every height: an 18px colour swatch and
  // a 30px image inside a button are content dimensions, not control heights,
  // and a blanket scan would call them violations.
  test.each([
    'common/Button.tsx',
    'common/TextBox.tsx',
    'common/Toast.tsx',
    'home/leftpane/HeroContainerLeft.tsx',
    'settings/leftpane/HeroContainerLeftSettings.tsx',
  ])('%s takes its height from the scale', (name) => {
    const file = FILES.find((f) => f.name.endsWith(name));
    expect(file, `${name} was not read by the scan`).toBeDefined();
    expect(file!.code).toMatch(/(min-)?height: \$\{CONTROL\./);
  });

  // Icon sizes come from the ICON scale. Not "there is only one" -- that was
  // tried and reverted, because two levels is a real distinction. What is
  // banned is a size invented at a call site, which is how three values ended
  // up doing two jobs and the toolbar came to look undersized.
  test('every icon size is a named level', () => {
    const offenders = FILES.flatMap((f) =>
      [...f.code.matchAll(/iconSize=\{?["']?([^"'}\s]+)["']?\}?/g)]
        .map((m) => m[1])
        .filter((v) => !v.startsWith('ICON.'))
        .map((v) => `${f.name}: ${v}`)
    );
    expect(
      offenders,
      'icon sizes come from ICON in styles/scale.ts:\n' + offenders.join('\n')
    ).toEqual([]);
  });

  // CONTROL. Every assertion above passes trivially against a scan that reads
  // nothing -- an empty file list, a regex that never matches, an exclusion
  // that swallowed the whole tree. This is what makes them claims about the
  // components rather than about the walker.
  test('CONTROL: the scan actually reads the components', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.some((f) => f.name.includes('common/Button'))).toBe(true);
  });

  // CONTROL, on the detector rather than on the codebase.
  //
  // This replaced a weaker one that proved the scan could see values by finding
  // a font-size literal somewhere in the components. That premise died the
  // moment the last literal was replaced -- i.e. on success -- so it was a
  // control that could only pass while the work was unfinished. Feeding the
  // matchers a known string instead keeps them honest whatever the source says.
  test('CONTROL: the matchers detect an off-scale value', () => {
    const offScale = 'font-size: 1.4rem; border-radius: 7px;';
    expect(literals(offScale, 'font-size')).toEqual(['1.4rem']);
    expect(literals(offScale, 'border-radius')).toEqual(['7px']);
    expect(sizeProps('<Label size="1.4rem" />')).toEqual(['1.4rem']);

    // And they do NOT flag a value that came from the scale.
    expect(literals('font-size: ${TYPE.BODY};', 'font-size')).toEqual([]);
    expect(sizeProps('<Label size={TYPE.BODY} />')).toEqual([]);
  });

  test('CONTROL: the excluded area really is excluded', () => {
    expect(FILES.some((f) => f.name.includes('components/export/'))).toBe(
      false
    );
  });

  test('the scales themselves have no duplicate values', () => {
    for (const scale of [TYPE, RADIUS, DURATION]) {
      const values = Object.values(scale);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

import { describe, expect, test } from 'vitest';

const LOCALES = import.meta.glob('../../../public/locales/*/translation.json', {
  eager: true,
  import: 'default',
}) as Record<string, Record<string, string>>;

// KAN-921. A Settings path reads the same everywhere: Settings › Sync & backup.
describe('Settings paths', () => {
  test('all 13 languages are read', () => {
    expect(Object.keys(LOCALES)).toHaveLength(13);
  });

  test.each(Object.entries(LOCALES))('%s has no arrow', (_, strings) => {
    expect(Object.entries(strings).flat().join('\n')).not.toContain('→');
  });
});

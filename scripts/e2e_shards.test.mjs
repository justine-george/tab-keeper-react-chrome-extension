import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import ShardByTime from './e2e_shard_reporter.mjs';
import {
  assignShards,
  meanTestSecondsByFile,
  WEIGHTS_FILE,
} from './e2e_shards.mjs';

const loads = (files, shards, weights, total) => {
  const out = new Array(total).fill(0);
  files.forEach((f, i) => (out[shards[i] - 1] += weights[f]));
  return out;
};

describe('assignShards', () => {
  // The KAN-444 case: slow tests in one file, which a count split puts in one shard.
  test('splits by time, not count, when one file is slow', () => {
    const weights = { 'slow.spec.ts': 4, 'fast.spec.ts': 1 };
    const files = [
      ...new Array(40).fill('fast.spec.ts'),
      ...new Array(10).fill('slow.spec.ts'),
    ];
    const shards = assignShards(files, weights, 4);
    expect(loads(files, shards, weights, 4)).toEqual([20, 20, 20, 20]);
  });

  test('puts every test in exactly one shard, numbered from 1', () => {
    const files = ['a', 'b', 'a', 'c', 'b', 'a', 'c'];
    const shards = assignShards(files, { a: 3, b: 2, c: 1 }, 3);
    expect(shards).toHaveLength(files.length);
    for (const s of shards) expect([1, 2, 3]).toContain(s);
  });

  test('gives the same split on every call', () => {
    const files = ['x', 'y', 'x', 'z', 'y', 'x'];
    const weights = { x: 2, y: 2, z: 2 };
    expect(assignShards(files, weights, 4)).toEqual(
      assignShards(files, weights, 4)
    );
  });

  test('weighs a file it has no timing for as the mean of the rest', () => {
    // new weighs (6 + 2) / 2 = 4: a shard to itself, while the two y's share
    // one. At any weight below 4 it would join a y.
    const files = ['x', 'y', 'y', 'new'];
    const shards = assignShards(files, { x: 6, y: 2 }, 3);
    expect(shards[1]).toBe(shards[2]);
    expect(new Set(shards).size).toBe(3);
  });

  test('with no timings at all, splits by count', () => {
    const shards = assignShards(['a', 'b', 'c', 'd'], {}, 2);
    expect(shards.filter((s) => s === 1)).toHaveLength(2);
  });

  test('refuses a shard total that is not a positive integer', () => {
    expect(() => assignShards(['a'], {}, 0)).toThrow(/positive integer/);
    expect(() => assignShards(['a'], {}, 1.5)).toThrow(/positive integer/);
  });
});

describe('meanTestSecondsByFile', () => {
  const spec = (file, ...durations) => ({
    file,
    tests: [
      {
        results: durations.map((duration) => ({ duration, status: 'passed' })),
      },
    ],
  });
  const ended = (file, status, duration) => ({
    file,
    tests: [{ results: [{ duration, status }] }],
  });

  test('averages each file across nested suites and reports', () => {
    const a = {
      suites: [
        {
          specs: [spec('b.spec.ts', 1000)],
          suites: [{ specs: [spec('b.spec.ts', 3000)] }],
        },
      ],
    };
    const b = { suites: [{ specs: [spec('a.spec.ts', 500)] }] };
    const weights = meanTestSecondsByFile([a, b]);
    expect(weights).toEqual({ 'a.spec.ts': 0.5, 'b.spec.ts': 2 });
    expect(Object.keys(weights)).toEqual(['a.spec.ts', 'b.spec.ts']);
  });

  test('counts a retried test once, by its last result', () => {
    const report = { suites: [{ specs: [spec('r.spec.ts', 30000, 2000)] }] };
    expect(meanTestSecondsByFile([report])).toEqual({ 'r.spec.ts': 2 });
  });

  test('skips a test that has no result', () => {
    const report = {
      suites: [{ specs: [spec('n.spec.ts'), spec('n.spec.ts', 1000)] }],
    };
    expect(meanTestSecondsByFile([report])).toEqual({ 'n.spec.ts': 1 });
  });

  test('counts only passed results, and leaves out a file with none', () => {
    const report = {
      suites: [
        {
          specs: [
            spec('m.spec.ts', 2000),
            ended('m.spec.ts', 'skipped', 0),
            ended('m.spec.ts', 'timedOut', 30000),
            ended('s.spec.ts', 'skipped', 0),
          ],
        },
      ],
    };
    expect(meanTestSecondsByFile([report])).toEqual({ 'm.spec.ts': 2 });
  });
});

describe('the committed weights', () => {
  test('are positive seconds per spec file', () => {
    const weights = JSON.parse(readFileSync(WEIGHTS_FILE, 'utf8'));
    expect(Object.keys(weights).length).toBeGreaterThan(0);
    for (const [file, secs] of Object.entries(weights)) {
      expect(file).toMatch(/\.spec\.ts$/);
      expect(secs).toBeGreaterThan(0);
    }
  });
});

describe('the shard reporter', () => {
  const committed = JSON.parse(readFileSync(WEIGHTS_FILE, 'utf8'));
  // Seven real spec files, so the reporter weighs them as CI does.
  const FILES = Object.keys(committed).slice(0, 7);
  const run = async (shard, { files = FILES, weightsFile } = {}) => {
    const tests = files.map((f) => ({ location: { file: `/repo/e2e/${f}` } }));
    const excluded = new Set();
    let skippedSharding = false;
    await new ShardByTime({ weightsFile }).preprocess({
      config: { shard, rootDir: '/repo/e2e' },
      suite: { allTests: () => tests },
      testRun: {
        skipSharding: () => (skippedSharding = true),
        exclude: (t) => excluded.add(tests.indexOf(t)),
      },
    });
    const kept = files.map((_, i) => i).filter((i) => !excluded.has(i));
    return { kept, excluded: [...excluded], skippedSharding };
  };
  const weightsOf = (weights) => {
    const file = join(mkdtempSync(join(tmpdir(), 'shard-')), 'w.json');
    writeFileSync(file, JSON.stringify(weights));
    return file;
  };

  test('without --shard, leaves the run alone', async () => {
    expect(await run(null)).toEqual({
      kept: FILES.map((_, i) => i),
      excluded: [],
      skippedSharding: false,
    });
  });

  test('under --shard, each shard keeps exactly the tests assignShards gives it', async () => {
    const shards = assignShards(FILES, committed, 3);
    const kept = [];
    for (const current of [1, 2, 3]) {
      const one = await run({ total: 3, current });
      expect(one.skippedSharding).toBe(true);
      expect(one.kept).toEqual(
        FILES.map((_, i) => i).filter((i) => shards[i] === current)
      );
      kept.push(...one.kept);
    }
    expect(kept.sort((a, b) => a - b)).toEqual(FILES.map((_, i) => i));
  });

  test('refuses to run when under half the tests have a weight', async () => {
    const files = ['new-a.spec.ts', 'new-b.spec.ts', FILES[0]];
    await expect(run({ total: 2, current: 1 }, { files })).rejects.toThrow(
      /1 of 3 tests have a weight/
    );
  });

  test('refuses a shard left with no tests', async () => {
    const weightsFile = weightsOf({ 'z.spec.ts': 0 });
    const files = ['z.spec.ts', 'z.spec.ts', 'z.spec.ts'];
    await expect(
      run({ total: 2, current: 2 }, { files, weightsFile })
    ).rejects.toThrow(/shard 2\/2 got no tests/);
  });
});

// The reporter deals tests one by one, so a serial group would be split across shards.
describe('the e2e specs', () => {
  const SERIAL = /describe\.serial|mode:\s*['"]serial['"]/;
  const e2e = new URL('../e2e/', import.meta.url);
  const sources = readdirSync(e2e, { recursive: true })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(new URL(f, e2e), 'utf8')]);

  test('none runs serially', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(
      sources.filter(([, src]) => SERIAL.test(src)).map(([f]) => f)
    ).toEqual([]);
  });

  test('CONTROL: the check sees both ways of asking', () => {
    expect(SERIAL.test("test.describe.serial('x', () => {})")).toBe(true);
    expect(SERIAL.test("test.describe.configure({ mode: 'serial' })")).toBe(
      true
    );
  });
});

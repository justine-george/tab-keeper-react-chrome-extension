import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import ShardByTime from './e2e_shard_reporter.mjs';
import {
  assignShards,
  meanSecondsPerFile,
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

describe('meanSecondsPerFile', () => {
  const spec = (file, ...durations) => ({
    file,
    tests: [{ results: durations.map((duration) => ({ duration })) }],
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
    const weights = meanSecondsPerFile([a, b]);
    expect(weights).toEqual({ 'a.spec.ts': 0.5, 'b.spec.ts': 2 });
    expect(Object.keys(weights)).toEqual(['a.spec.ts', 'b.spec.ts']);
  });

  test('counts a retried test once, by its last result', () => {
    const report = { suites: [{ specs: [spec('r.spec.ts', 30000, 2000)] }] };
    expect(meanSecondsPerFile([report])).toEqual({ 'r.spec.ts': 2 });
  });

  test('skips a test that has no result', () => {
    const report = {
      suites: [{ specs: [spec('n.spec.ts'), spec('n.spec.ts', 1000)] }],
    };
    expect(meanSecondsPerFile([report])).toEqual({ 'n.spec.ts': 1 });
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
  const run = async (shard) => {
    const tests = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts'].map(
      (f) => ({ location: { file: `/repo/e2e/${f}` } })
    );
    const excluded = [];
    let skippedSharding = false;
    await new ShardByTime().preprocess({
      config: { shard, rootDir: '/repo/e2e' },
      suite: { allTests: () => tests },
      testRun: {
        skipSharding: () => (skippedSharding = true),
        exclude: (t) => excluded.push(t.location.file),
      },
    });
    return { excluded, skippedSharding };
  };

  test('without --shard, leaves the run alone', async () => {
    expect(await run(null)).toEqual({ excluded: [], skippedSharding: false });
  });

  test('under --shard, takes over and keeps only its own tests', async () => {
    const one = await run({ total: 2, current: 1 });
    const two = await run({ total: 2, current: 2 });
    expect(one.skippedSharding).toBe(true);
    expect(one.excluded).toHaveLength(2);
    expect(two.excluded).toHaveLength(2);
    expect([...one.excluded, ...two.excluded].sort()).toEqual(
      ['a', 'b', 'c', 'd'].map((f) => `/repo/e2e/${f}.spec.ts`)
    );
  });
});

// Splits the e2e suite into CI shards of equal measured time (KAN-444).
// Playwright's --shard cuts the test list by count into contiguous runs, so a
// file of slow tests lands whole in one shard: 692s against 272s on 6 shards.
//
//   gh run download <run-id> -p 'timings-shard-*'
//   node scripts/e2e_shards.mjs timings-shard-*/results-shard-*.json
//
// rewrites e2e/shard-weights.json from a green CI run's per-shard JSON reports.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WEIGHTS_FILE = fileURLToPath(
  new URL('../e2e/shard-weights.json', import.meta.url)
);

/**
 * Mean seconds per test for each spec file in Playwright JSON reports. A test
 * counts once, by its last result, if that passed or skipped (a failure or
 * timeout would weigh its timeout). A weight is at least 0.01s.
 * @param {Array<{ suites?: object[] }>} reports
 * @returns {Record<string, number>} file (relative to e2e/) -> mean seconds
 */
export function meanTestSecondsByFile(reports) {
  /** @type {Map<string, number[]>} */
  const byFile = new Map();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        if (last?.status !== 'passed' && last?.status !== 'skipped') continue;
        const list = byFile.get(spec.file) ?? [];
        list.push(last.duration / 1000);
        byFile.set(spec.file, list);
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const report of reports)
    for (const suite of report.suites ?? []) walk(suite);

  return Object.fromEntries(
    [...byFile.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([file, secs]) => [
        file,
        Math.max(
          0.01,
          Math.round((secs.reduce((a, b) => a + b, 0) / secs.length) * 100) /
            100
        ),
      ])
  );
}

/**
 * Deals tests to `total` shards, heaviest first, each to the lightest shard so
 * far. A test weighs its file's mean; a file missing from `weights` weighs the
 * mean of those present. Every shard computes the same split from the same
 * test list, so together they run each test exactly once.
 * @param {string[]} files the spec file of each test, in Playwright's order
 * @param {Record<string, number>} weights mean seconds per test, by file
 * @param {number} total shard count, at least 1
 * @returns {number[]} the 1-based shard of each test, in the same order
 */
export function assignShards(files, weights, total) {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard total must be a positive integer, got ${total}`);
  }
  const known = Object.values(weights);
  const fallback =
    known.length === 0 ? 1 : known.reduce((a, b) => a + b, 0) / known.length;
  const weightOf = (file) => weights[file] ?? fallback;

  const order = files
    .map((file, index) => ({ file, index, weight: weightOf(file) }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
        a.index - b.index
    );

  const load = new Array(total).fill(0);
  const shardOf = new Array(files.length);
  for (const { index, weight } of order) {
    let lightest = 0;
    for (let s = 1; s < total; s += 1)
      if (load[s] < load[lightest]) lightest = s;
    load[lightest] += weight;
    shardOf[index] = lightest + 1;
  }
  return shardOf;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error(
      'usage: node scripts/e2e_shards.mjs timings-shard-*/results-shard-*.json'
    );
    process.exit(1);
  }
  const reports = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
  const weights = meanTestSecondsByFile(reports);
  writeFileSync(WEIGHTS_FILE, `${JSON.stringify(weights, null, 2)}\n`);
  console.log(`wrote ${Object.keys(weights).length} files to ${WEIGHTS_FILE}`);
}

// A Playwright reporter that only shards: under --shard=i/n it replaces the
// built-in count split with scripts/e2e_shards.mjs's time split (KAN-444).
// Without --shard it does nothing. Tests are dealt one by one, so no spec may
// run serially (e2e_shards.test.mjs checks).
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { assignShards, WEIGHTS_FILE } from './e2e_shards.mjs';

export default class ShardByTime {
  constructor({ weightsFile = WEIGHTS_FILE } = {}) {
    this.weightsFile = weightsFile;
  }

  async preprocess({ config, suite, testRun }) {
    if (config.shard === null) return;
    testRun.skipSharding();
    const { current, total } = config.shard;
    const weights = JSON.parse(readFileSync(this.weightsFile, 'utf8'));
    const tests = suite.allTests();
    const files = tests.map((t) => relative(config.rootDir, t.location.file));
    // Under half weighed means the keys stopped matching, not a few new files.
    const unweighed = files.filter((f) => !Object.hasOwn(weights, f));
    if (unweighed.length * 2 > files.length) {
      throw new Error(
        `${files.length - unweighed.length} of ${
          files.length
        } tests have a weight in ${this.weightsFile} (one without: ${
          unweighed[0]
        })`
      );
    }
    const shards = assignShards(files, weights, total);
    if (tests.length >= total && !shards.includes(current)) {
      throw new Error(`shard ${current}/${total} got no tests`);
    }
    tests.forEach((test, i) => {
      if (shards[i] !== current) testRun.exclude(test);
    });
  }

  printsToStdio() {
    return false;
  }
}

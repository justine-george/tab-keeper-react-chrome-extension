// A Playwright reporter that only shards: under --shard=i/n it replaces the
// built-in count split with scripts/e2e_shards.mjs's time split (KAN-444).
// Without --shard it does nothing.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { assignShards, WEIGHTS_FILE } from './e2e_shards.mjs';

export default class ShardByTime {
  async preprocess({ config, suite, testRun }) {
    if (config.shard === null) return;
    testRun.skipSharding();
    const weights = JSON.parse(readFileSync(WEIGHTS_FILE, 'utf8'));
    const tests = suite.allTests();
    const shards = assignShards(
      tests.map((t) => relative(config.rootDir, t.location.file)),
      weights,
      config.shard.total
    );
    tests.forEach((test, i) => {
      if (shards[i] !== config.shard.current) testRun.exclude(test);
    });
  }

  printsToStdio() {
    return false;
  }
}

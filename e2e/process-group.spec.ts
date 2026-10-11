import { test, expect } from '@playwright/test';

import { once } from 'node:events';

import {
  livePidsInGroup,
  startProcessGroup,
  stopProcessGroup,
} from './fixtures/processGroup';

// KAN-479. A shell that starts a sleep and prints its pid: the sleep stands in for
// Chrome's network service, which a kill of the browser alone left running.
async function shellWithChild(prelude = '') {
  const leader = startProcessGroup('sh', [
    '-c',
    `${prelude} sleep 30 & echo $!; wait`,
  ]);
  const [chunk] = await once(leader.stdout, 'data');
  const child = Number(String(chunk));
  const pgid = leader.pid;
  if (pgid === undefined) throw new Error('the shell did not start');
  expect(livePidsInGroup(pgid)).toEqual(expect.arrayContaining([pgid, child]));
  return { leader, pgid, child };
}

test('stopping the group stops the processes its leader started', async () => {
  const { leader, pgid, child } = await shellWithChild();
  await stopProcessGroup(leader);
  expect(livePidsInGroup(pgid)).not.toContain(child);
  expect(livePidsInGroup(pgid)).toEqual([]);
});

test('a group that ignores SIGTERM is killed once the wait runs out', async () => {
  // An ignored signal stays ignored in the sleep the shell starts.
  const { leader, pgid } = await shellWithChild("trap '' TERM;");
  const ended = once(leader, 'exit');
  await stopProcessGroup(leader, 300);
  expect(livePidsInGroup(pgid)).toEqual([]);
  expect(await ended).toEqual([null, 'SIGKILL']);
});

test('a command that never started has nothing to stop', async () => {
  const leader = startProcessGroup('/nonexistent/kan-479', []);
  const failed = once(leader, 'error');
  await stopProcessGroup(leader);
  await expect(failed).resolves.toEqual([
    expect.objectContaining({ code: 'ENOENT' }),
  ]);
});

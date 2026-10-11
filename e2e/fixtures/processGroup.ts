import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

// KAN-479. A process and everything it starts, stopped together: Chrome's network
// service outlived a kill of the browser alone and wrote into the profile being deleted.

// The leader of a new process group, so stopProcessGroup reaches its children too.
export function startProcessGroup(
  command: string,
  args: string[]
): ChildProcessWithoutNullStreams {
  return spawn(command, args, { detached: true });
}

// Members not yet exited. ps, not kill(-pgid, 0): kill counts zombies, and the CI
// container's PID 1 (`tail`) never reaps the orphans.
export function livePidsInGroup(pgid: number): number[] {
  return execFileSync('ps', ['-eo', 'pid=,pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([, group, stat]) => Number(group) === pgid && !stat.startsWith('Z')
    )
    .map(([pid]) => Number(pid));
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function signalUntilGone(
  pgid: number,
  signal: NodeJS.Signals,
  timeoutMs: number
): Promise<boolean> {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    // ESRCH: no member left to signal.
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    )) {
      throw error;
    }
  }
  for (let waited = 0; waited < timeoutMs; waited += 50) {
    if (livePidsInGroup(pgid).length === 0) return true;
    await sleep(50);
  }
  return livePidsInGroup(pgid).length === 0;
}

// Resolves once no member is running: SIGTERM, then SIGKILL after timeoutMs.
// A process that never started has no group, so there is nothing to stop.
export async function stopProcessGroup(
  leader: ChildProcessWithoutNullStreams,
  timeoutMs = 5000
): Promise<void> {
  const pgid = leader.pid;
  if (pgid === undefined) return;
  if (await signalUntilGone(pgid, 'SIGTERM', timeoutMs)) return;
  if (await signalUntilGone(pgid, 'SIGKILL', timeoutMs)) return;
  throw new Error(
    `process group ${pgid} still running after SIGKILL: ${livePidsInGroup(pgid).join(', ')}`
  );
}

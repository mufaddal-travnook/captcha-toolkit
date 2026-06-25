/**
 * Single-instance guard (cross-platform, like flock). Prevents a slow run from
 * overlapping the next scheduled tick.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';

export interface Lock {
  release: () => Promise<void>;
}

/**
 * Acquire an exclusive lock on `lockPath`. Throws if another run holds it.
 * The lockfile target must exist, so we create it if missing.
 */
export async function acquireLock(lockPath: string): Promise<Lock> {
  await mkdir(dirname(lockPath), { recursive: true });
  // proper-lockfile locks an existing file; ensure one is present.
  await writeFile(lockPath, '', { flag: 'a' });

  try {
    const release = await lockfile.lock(lockPath, { stale: 5 * 60_000, retries: 0 });
    return { release };
  } catch {
    throw new Error(
      `Another login-bot run is already in progress (lock held: ${lockPath}). Skipping.`,
    );
  }
}

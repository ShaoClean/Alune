import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

export function defaultDataDirectory(): string {
  if (process.env.ALUNE_AGENT_DATA_DIR) return process.env.ALUNE_AGENT_DATA_DIR;
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Alune', 'agent');
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Alune', 'agent');
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'alune', 'agent');
}
export async function loadIdentity(directory: string): Promise<string> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'identity.json');
  let fd: number | undefined;
  try {
    fd = openSync(file, 'wx', 0o600);
    const agentId = randomUUID();
    writeFileSync(fd, JSON.stringify({ agentId }) + '\n');
    fsyncSync(fd);
    return agentId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    if (statSync(file).size > 1024) throw new Error('Invalid Agent identity file');
    const text = readFileSync(file, 'utf8');
    if (!text && attempt < 19) {
      await delay(25);
      continue;
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        'Invalid Agent identity file; restore the existing identity rather than replacing it',
      );
    }
    if (
      !value ||
      typeof value.agentId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.agentId)
    )
      throw new Error('Invalid Agent identity');
    return value.agentId;
  }
  throw new Error('Agent identity unavailable');
}

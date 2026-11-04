import { resolve } from 'node:path';
import { doctor } from '../adapters/doctor';
import { PROTOCOL_VERSION } from '@alune/protocol';
import { loadIdentity, defaultDataDirectory } from '../adapters/identity';
import { serveStdio } from '../bootstrap/stdio';

export async function main(args = process.argv.slice(2)): Promise<number> {
  const version: string = require('../../package.json').version;
  const command = args[0] ?? 'help';
  if (command === 'version' || command === '--version') {
    process.stdout.write(
      JSON.stringify({ name: 'alune-agent', version, protocol: PROTOCOL_VERSION }) + '\n',
    );
    return 0;
  }
  if (command === 'doctor') {
    const result = await doctor();
    process.stdout.write(JSON.stringify(result) + '\n');
    return result.ok ? 0 : 1;
  }
  if (command === 'serve') {
    if (!(args.length === 1 || (args.length === 3 && args[1] === '--data-dir' && args[2])))
      throw new Error('Usage: alune-agent serve [--data-dir DIRECTORY]');
    const agentId = await loadIdentity(resolve(args[2] ?? defaultDataDirectory()));
    await serveStdio({ agentId, version });
    return 0;
  }
  process.stdout.write('Usage: alune-agent version | doctor | serve [--data-dir DIRECTORY]\n');
  return command === 'help' || command === '--help' ? 0 : 1;
}

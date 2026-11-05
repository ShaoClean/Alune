import { resolve, join } from 'node:path';
import { doctor } from '../adapters/doctor';
import { PROTOCOL_VERSION } from '@alune/protocol';
import { loadIdentity, defaultDataDirectory } from '../adapters/identity';
import { serveStdio } from '../bootstrap/stdio';
import { openStateKernel } from '../bootstrap/state-kernel';
import { stateDirectory, statePathExists, assertRegularFile } from '../adapters/private-files';
import { AgentState } from '../adapters/sqlite/state';
import { StateFault } from '../ports/state';
import { legacyIpcDecryptor } from '../adapters/secrets/legacy-ipc';
import { recoveryPassphrase } from './recovery-passphrase';

function stateOptions(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const name = args[i],
      value = args[i + 1];
    if (
      !['--data-dir', '--backup', '--source', '--input', '--output'].includes(name) ||
      !value ||
      options.has(name)
    )
      throw new Error('Invalid state command options');
    options.set(name, value);
  }
  return options;
}
async function stateIdentity(directory: string): Promise<string> {
  stateDirectory(directory);
  const identity = join(directory, 'identity.json');
  if (statePathExists(join(directory, 'state')) && !statePathExists(identity))
    throw new StateFault(
      'corrupt',
      'Agent identity is missing; restore it before opening existing state',
    );
  assertRegularFile(identity);
  return loadIdentity(directory);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const version: string = require('../version.json').version;
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
  if (
    [
      'serve',
      'state-backup',
      'state-restore',
      'legacy-import',
      'recovery-backup',
      'recovery-restore',
    ].includes(command)
  ) {
    const options = stateOptions(args);
    if (command !== 'state-restore' && options.has('--backup'))
      throw new Error('--backup is only valid for state-restore');
    if (command === 'state-restore' && !options.has('--backup'))
      throw new Error('state-restore requires --backup DIRECTORY');
    if (command !== 'legacy-import' && options.has('--source'))
      throw new Error('--source is only valid for legacy-import');
    if (command === 'legacy-import' && !options.has('--source'))
      throw new Error('legacy-import requires --source DIRECTORY');
    if (command !== 'recovery-backup' && options.has('--output'))
      throw new Error('--output is only valid for recovery-backup');
    if (command !== 'recovery-restore' && options.has('--input'))
      throw new Error('--input is only valid for recovery-restore');
    if (command === 'recovery-backup' && !options.has('--output'))
      throw new Error('recovery-backup requires --output FILE');
    if (command === 'recovery-restore' && !options.has('--input'))
      throw new Error('recovery-restore requires --input FILE');
    const directory = resolve(options.get('--data-dir') ?? defaultDataDirectory());
    if (
      !['serve', 'legacy-import', 'recovery-restore'].includes(command) &&
      !statePathExists(join(directory, 'state'))
    )
      throw new StateFault('unavailable', 'Agent state is not initialized');
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    let kernel: Awaited<ReturnType<typeof openStateKernel>> | undefined;
    try {
      if (command === 'recovery-restore') {
        const { restoreRecoveryBackup } = await import('../adapters/migration/recovery');
        const passphrase = await recoveryPassphrase(controller.signal);
        try {
          const receipt = await restoreRecoveryBackup(
            directory,
            resolve(options.get('--input')!),
            passphrase,
            { signal: controller.signal },
          );
          process.stdout.write(JSON.stringify(receipt) + '\n');
          return 0;
        } finally {
          passphrase.fill(0);
        }
      }
      const agentId = await stateIdentity(directory);
      if (command === 'recovery-backup') {
        const { createRecoveryBackup } = await import('../adapters/migration/recovery');
        const passphrase = await recoveryPassphrase(controller.signal);
        let state: AgentState | undefined;
        try {
          state = await AgentState.open(directory, agentId, controller.signal);
          const receipt = await createRecoveryBackup(
            state,
            resolve(options.get('--output')!),
            passphrase,
            controller.signal,
          );
          process.stdout.write(JSON.stringify(receipt) + '\n');
          return 0;
        } finally {
          passphrase.fill(0);
          await state?.close();
        }
      }
      if (command === 'legacy-import') {
        const { importLegacyState } = await import('../modules/migration/legacy');
        const state = await AgentState.open(directory, agentId, controller.signal);
        let bridge: ReturnType<typeof legacyIpcDecryptor> | undefined;
        try {
          bridge = process.connected ? legacyIpcDecryptor() : undefined;
          if (bridge) process.once('disconnect', stop);
          const receipt = await importLegacyState(state, resolve(options.get('--source')!), {
            signal: controller.signal,
            ...(bridge ? { decryptSafeStorage: bridge.decrypt } : {}),
          });
          process.stdout.write(JSON.stringify(receipt) + '\n');
          return 0;
        } finally {
          bridge?.close();
          process.off('disconnect', stop);
          await state.close();
          if (process.connected) process.disconnect();
        }
      }
      if (command === 'state-restore') {
        const result = await AgentState.restore(
          directory,
          agentId,
          resolve(options.get('--backup')!),
          controller.signal,
        );
        process.stdout.write(JSON.stringify({ ...result, scope: 'database-only' }) + '\n');
        return 0;
      }
      kernel = await openStateKernel(directory, agentId, controller.signal);
      controller.signal.throwIfAborted();
      if (command === 'state-backup') {
        const backup = await kernel.state.backup(controller.signal);
        process.stdout.write(JSON.stringify({ backup, scope: 'database-only' }) + '\n');
        return 0;
      }
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
      await serveStdio({
        agentId,
        version,
        handlers: kernel.handlers,
        taskJournal: kernel.taskJournal,
        onDispose: kernel.close,
      });
      return 0;
    } finally {
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
      await kernel?.close();
    }
  }
  process.stdout.write(
    'Usage: alune-agent version | doctor | serve | state-backup | state-restore --backup DIRECTORY | legacy-import --source DIRECTORY | recovery-backup --output FILE | recovery-restore --input FILE [--data-dir DIRECTORY]\nRecovery passphrases are read from stdin.\n',
  );
  return command === 'help' || command === '--help' ? 0 : 1;
}

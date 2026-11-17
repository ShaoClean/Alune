import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
const [command = 'list', ...args] = process.argv.slice(2);
const commands = manifest.entries.filter((entry) => entry.command);
if (command === 'list') {
  console.log(
    JSON.stringify(
      commands.map((entry) => ({
        command: path.basename(entry.path).replace(/\.[cm]js$/, ''),
        original: entry.original,
      })),
      null,
      2,
    ),
  );
} else {
  let childArgs;
  if (command === 'test') {
    childArgs = [
      ...process.execArgv,
      '--test',
      ...args,
      ...manifest.defaultTests,
      'scripts/archive/agent-acceptance/replay-support.test.mjs',
    ];
  } else {
    const entry = commands.find((item) =>
      [path.basename(item.path), path.basename(item.path).replace(/\.[cm]js$/, '')].includes(
        command,
      ),
    );
    if (!entry)
      throw Error(
        'Unknown archived command: ' + command + '; run with list to see available commands',
      );
    childArgs = [...process.execArgv, entry.path, ...args];
  }
  const child = spawn(process.execPath, childArgs, { cwd: root, stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  const dispose = () => {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  child.once('error', (error) => {
    dispose();
    console.error(error);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    dispose();
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
}

// Shared mechanics for historical replay drivers. Scenario assertions and
// evidence eligibility remain in their original plans and validators.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const json = (value) =>
  JSON.stringify(
    value,
    (_key, item) =>
      item instanceof Error
        ? { name: item.name, message: item.message, stack: item.stack, errors: item.errors }
        : item,
    2,
  ) + '\n';

export function createReplayContext(root) {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file)));
  const walk = (directory) =>
    fs
      .readdirSync(path.join(root, directory), { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      );
  const digest = (files) =>
    Object.fromEntries(
      [...new Set(files)]
        .sort()
        .map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]),
    );
  return { hash, json, git, read, walk, digest };
}

export function createCommandRecorder({ root, output, commands, legacy = false }) {
  return (name, args, options = legacy ? false : {}) => {
    const {
      independent = false,
      expectedExit = 0,
      env = {},
    } = legacy ? { independent: options } : options;
    const log = 'logs/' + name + '.log';
    const fd = fs.openSync(path.join(output, log), 'wx');
    const startedAt = new Date().toISOString();
    let result;
    try {
      result = spawnSync(process.execPath, args, {
        cwd: root,
        stdio: ['ignore', fd, fd],
        timeout: 240000,
        env: {
          ...process.env,
          PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
          ...env,
        },
      });
    } finally {
      fs.closeSync(fd);
    }
    commands.push({
      name,
      executable: process.execPath,
      args,
      ...(!legacy ? { environmentOverrides: env } : {}),
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode: result.status,
      ...(!legacy ? { expectedExit } : {}),
      signal: result.signal,
      error: result.error?.message,
      independent,
      log: { path: log, sha256: hash(fs.readFileSync(path.join(output, log))) },
    });
    fs.writeFileSync(path.join(output, 'commands.json'), json(commands));
    if (result.status !== expectedExit && !independent)
      throw Error((legacy ? 'Check failed: ' : 'Unexpected command result: ') + name);
  };
}

export function runtimeToolInventory() {
  return [
    ['git', ['--version']],
    ['ssh', ['-V']],
    ['python3', ['--version']],
    ['sh', []],
    ['grep', []],
    ['env', []],
  ].map(([name, args]) => {
    const executable = execFileSync('/bin/sh', ['-c', 'command -v ' + name], {
      encoding: 'utf8',
    }).trim();
    const realpath = fs.realpathSync(executable);
    const version = args.length ? spawnSync(executable, args, { encoding: 'utf8' }) : undefined;
    return {
      name,
      executable,
      realpath,
      sha256: hash(fs.readFileSync(realpath)),
      versionArgs: args,
      version: version
        ? { exitCode: version.status, stdout: version.stdout, stderr: version.stderr }
        : null,
    };
  });
}

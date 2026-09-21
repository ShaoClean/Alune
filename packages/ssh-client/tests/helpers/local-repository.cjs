const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, execFileSync } = require('node:child_process');

// Exercise the production commands against real Git and disk, behind the same
// exec/SFTP interface used by SSH. Each fixture owns its entire temporary root.
function createRepository({ initial = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-delete-'));
  const repo = path.join(root, "仓库 ' $repo");
  fs.mkdirSync(repo);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    LC_ALL: 'C',
  };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'Deletion test');
  git('config', 'user.email', 'fixture@example.invalid');
  if (initial) {
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'original\n');
    git('add', '--', 'tracked.txt');
    git('commit', '-qm', 'fixture');
  }
  const connection = {
    execCommand(command, cwd, signal) {
      return new Promise((resolve, reject) =>
        exec(
          command,
          { cwd: cwd || repo, env, signal, maxBuffer: 8 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error && typeof error.code !== 'number') return reject(error);
            resolve({ exitCode: error?.code || 0, stdout, stderr });
          },
        ),
      );
    },
    withSftp(operation) {
      return operation(fs);
    },
  };
  const write = (name, contents = 'new file\n') => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), contents);
  };
  return {
    root,
    repo,
    git,
    connection,
    write,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
module.exports = { createRepository };

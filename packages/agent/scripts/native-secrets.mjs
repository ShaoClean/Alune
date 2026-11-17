import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

if (process.platform === 'darwin') {
  const directory = fileURLToPath(new URL('..', import.meta.url));
  const source = path.join(directory, 'native/keychain.cc');
  const output = path.join(directory, 'dist/native/keychain.node');
  const headers = path.resolve(path.dirname(process.execPath), '../include/node');
  if (!fs.existsSync(path.join(headers, 'node_api.h')))
    throw new Error('Node headers are required to build the Keychain adapter');
  if (!fs.existsSync(output) || fs.statSync(output).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync(
      'xcrun',
      [
        '--sdk',
        'macosx',
        'clang++',
        '-std=c++17',
        '-mmacosx-version-min=11.0',
        '-shared',
        '-undefined',
        'dynamic_lookup',
        '-DNAPI_VERSION=8',
        '-Wno-deprecated-declarations',
        '-I',
        headers,
        '-framework',
        'Security',
        '-framework',
        'CoreFoundation',
        source,
        '-o',
        output,
      ],
      { stdio: 'inherit' },
    );
  }
}

if (['linux', 'darwin'].includes(process.platform)) {
  const dir = fileURLToPath(new URL('..', import.meta.url));
  const source = path.join(dir, 'native/pty-guardian.c'),
    output = path.join(dir, 'dist/native/pty-guardian');
  if (!fs.existsSync(output) || fs.statSync(output).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    execFileSync(
      'cc',
      [
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        ...(process.platform === 'darwin' ? ['-mmacosx-version-min=11.0'] : []),
        source,
        '-o',
        output,
      ],
      { stdio: 'inherit' },
    );
  }
}

if (process.platform === 'win32') {
  const dir = fileURLToPath(new URL('..', import.meta.url));
  const source = path.join(dir, 'native/git-tree.cs'),
    output = path.join(dir, 'dist/native/git-tree.exe');
  if (!fs.existsSync(output) || fs.statSync(output).mtimeMs < fs.statSync(source).mtimeMs) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const compiler = path.join(
      process.env.SystemRoot,
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/out:' + output, source], {
      stdio: 'inherit',
    });
  }
}

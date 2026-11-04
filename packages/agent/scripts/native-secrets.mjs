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

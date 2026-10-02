import { chmod, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// node-pty 1.1.0 ships macOS prebuilt spawn-helper without its executable bit.
// Normalize our installed copy and staged app, never system-owned binaries.
if (process.platform !== 'win32') {
  const directory = process.argv[2] || process.cwd();
  const require = createRequire(path.join(directory, 'package.json'));
  const root = path.dirname(require.resolve('node-pty/package.json'));
  for (const candidate of [
    path.join(root, 'build/Release/spawn-helper'),
    path.join(root, `prebuilds/${process.platform}-${process.arch}/spawn-helper`),
  ]) {
    try {
      await access(candidate);
    } catch {
      continue;
    }
    await chmod(candidate, 0o755);
  }
}

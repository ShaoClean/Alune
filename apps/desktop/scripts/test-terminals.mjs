// Compatibility command; terminals are exercised by the Agent acceptance driver.
import path from 'node:path';
if (process.argv.includes('--packaged') && !process.env.ALUNE_TEST_EXECUTABLE) {
  const relative = process.platform === 'darwin'
    ? `${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Alune.app/Contents/MacOS/Alune`
    : process.platform === 'win32' ? 'win-unpacked/Alune.exe' : 'linux-unpacked/alune';
  process.env.ALUNE_TEST_EXECUTABLE = path.resolve('release', relative);
}
if (process.argv.slice(2).some((arg) => arg !== '--packaged'))
  throw new Error('Usage: test-terminals.mjs [--packaged]');
process.argv = [process.argv[0], process.argv[1], '--focus', 'terminals'];
await import('./smoke.mjs');

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
// electron-builder's file matcher excludes node_modules in extraResources.
// This tree has its own Node ABI and must be copied byte-for-byte before signing.
module.exports = async (context) => {
  const source = path.resolve(__dirname, '../dist/agent-runtime');
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  const app = context.packager.appInfo;
  if (manifest.target !== process.platform + '-' + process.arch || manifest.version !== app.version)
    throw new Error('Independent runtime does not match the desktop target');
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, app.productFilename + '.app', 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const destination = path.join(resources, 'agent-runtime');
  await fs.cp(source, destination, { recursive: true });
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (
      createHash('sha256')
        .update(await fs.readFile(path.join(destination, name)))
        .digest('hex') !== expected
    )
      throw new Error('Invalid packaged Agent member: ' + name);
  }
};

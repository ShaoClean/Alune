// Synthetic state only. This entry is never copied into the standalone package.
const { openStateKernel } = require('../dist/bootstrap/state-kernel');
const { loadIdentity } = require('../dist/adapters/identity');
const { serveStdio } = require('../dist');
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const root = process.argv[2];
(async () => {
  const agentId = await loadIdentity(root);
  const kernel = await openStateKernel(root, agentId, undefined, { backend: 'file' });
  try {
    await serveStdio({
      agentId,
      version: 'fixture',
      handlers: {
        ...kernel.handlers,
        'fixture.journalCrash': {
          effect: 'mutation',
          validate() {},
          run() {
            appendFileSync(join(root, 'fixture-writes'), 'write\n');
            process.exit(7);
          },
        },
      },
      taskJournal: kernel.taskJournal,
      onDispose: kernel.close,
    });
  } finally {
    await kernel.close();
  }
})().catch(() => {
  process.stderr.write('Settings fixture failed\n');
  process.exitCode = 1;
});

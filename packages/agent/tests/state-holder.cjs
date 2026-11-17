const { AgentState } = require('../dist/adapters/sqlite/state');
(async () => {
  const store = await AgentState.open(
    process.env.ALUNE_STATE_FIXTURE_DIR,
    process.env.ALUNE_STATE_FIXTURE_ID,
  );
  const doc = store.document('fixture');
  doc.read();
  doc.write({ saved: 'before-kill' });
  store.database
    .prepare('INSERT INTO operations (id,method,fingerprint,state,started_at) VALUES (?,?,?,?,?)')
    .run(
      'interrupted',
      'fixture.write',
      'opaque-fixture-fingerprint',
      'running',
      new Date().toISOString(),
    );
  process.stdout.write('ready\n');
  const keepalive = setInterval(() => {}, 1000);
  process.once('SIGTERM', async () => {
    clearInterval(keepalive);
    await store.close();
    process.exit(0);
  });
})().catch((error) => {
  process.stderr.write(error.message);
  process.exit(1);
});

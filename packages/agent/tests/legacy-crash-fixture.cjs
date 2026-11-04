// Synthetic interruption exactly after the first business row is inserted.
const { AgentState } = require('../dist/adapters/sqlite/state');
const { importLegacyState } = require('../dist/modules/migration/legacy');
(async () => {
  const state = await AgentState.open(process.argv[2], process.argv[4]);
  const original = state.database.prepare.bind(state.database);
  state.database.prepare = sql => {
    const statement = original(sql);
    if (!sql.startsWith('INSERT INTO connections VALUES')) return statement;
    return { run(...args) { statement.run(...args); process.exit(7); } };
  };
  try { await importLegacyState(state, process.argv[3], { secretOptions: { backend: 'file' } }); }
  finally { await state.close(); }
})().catch(() => { process.stderr.write('Legacy interruption fixture failed'); process.exitCode = 1; });

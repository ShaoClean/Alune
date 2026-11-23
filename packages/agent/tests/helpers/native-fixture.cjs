const { NativeRepositoryConnection } = require('../../dist/adapters/git/native');

async function createNativeFixture() {
  const connection = new NativeRepositoryConnection();
  return { connection, close: () => connection.close() };
}

module.exports = { createNativeFixture };

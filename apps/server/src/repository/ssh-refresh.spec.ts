import Database from 'better-sqlite3';
import { RepositoryService } from './repository.service';
import { GitService } from '../git/git.service';
import { ConnectionService } from '../connection/connection.service';

const {
  createRepository,
} = require('../../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const {
  connectFixture,
} = require('../../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

describe('SSH refresh after staging', () => {
  it.each([1, 10])(
    'reads context, status and Diff with MaxSessions=%i',
    async (maxSessions) => {
      const fixture = createRepository();
      const db = new Database(':memory:');
      let ssh: Awaited<ReturnType<typeof connectFixture>>;
      try {
        ssh = await connectFixture(fixture, { maxSessions });
        db.exec(
          "CREATE TABLE connections (id TEXT PRIMARY KEY); INSERT INTO connections VALUES ('fixture')",
        );
        const connections = {
          ensureConnected: async () => ssh.connection,
        } as unknown as ConnectionService;
        const repositories = new RepositoryService(db, connections);
        const git = new GitService(connections, repositories);
        const repo = await repositories.add('fixture', fixture.repo);
        fixture.write('tracked.txt', 'staged change\n');
        await git.stage(repo.id, ['tracked.txt']);

        const results = await Promise.allSettled([
          repositories.getContext(repo.id),
          repositories.getStatus(repo.id),
          repositories.getDiff(repo.id, { file: 'tracked.txt', staged: true }),
          ...Array.from({ length: 4 }, () => repositories.getContext(repo.id)),
        ]);
        expect(
          results.filter((result) => result.status === 'rejected'),
        ).toEqual([]);
        expect(results[0]).toMatchObject({
          status: 'fulfilled',
          value: {
            author: { name: 'Deletion test', email: 'fixture@example.invalid' },
            shallow: false,
            unborn: false,
            source: 'ssh',
            remotes: [],
          },
        });
        expect(results[1]).toMatchObject({
          status: 'fulfilled',
          value: {
            files: [{ path: 'tracked.txt', staged: true }],
          },
        });
        expect(results[2]).toMatchObject({
          status: 'fulfilled',
          value: expect.stringContaining('+staged change'),
        });
      } finally {
        await ssh?.close();
        db.close();
        fixture.close();
      }
    },
    30000,
  );
});

import Database from 'better-sqlite3';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { SFTPWrapper } from 'ssh2';
import { SSHConnection } from '@alune/ssh-client';
import { RepositoryController } from './repository.controller';
import { RepositoryService } from './repository.service';
import { ConnectionService } from '../connection/connection.service';

const {
  createRepository,
} = require('../../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const {
  startSSHServer,
} = require('../../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

describe('SSH file preview HTTP errors', () => {
  it('returns a readable channel failure and keeps the API usable for retry and another file', async () => {
    const fixture = createRepository();
    const db = new Database(':memory:');
    let app: INestApplication | undefined;
    let connection: SSHConnection | undefined;
    let remote: Awaited<ReturnType<typeof startSSHServer>>;
    let interrupt = true;
    try {
      remote = await startSSHServer({
        onSftp(sftp: SFTPWrapper) {
          if (!interrupt) return;
          interrupt = false;
          sftp.removeAllListeners('READ');
          sftp.once('READ', () => sftp.end());
        },
      });
      connection = new SSHConnection(remote.options);
      connection.on('error', () => {});
      await connection.connect();
      db.exec(
        "CREATE TABLE connections (id TEXT PRIMARY KEY); INSERT INTO connections VALUES ('fixture')",
      );
      const repositories = new RepositoryService(db, {
        ensureConnected: async () => connection,
      } as unknown as ConnectionService);
      const repo = await repositories.add('fixture', fixture.repo);
      fixture.write('other.txt', '另一个文件\n');
      const module = await Test.createTestingModule({
        controllers: [RepositoryController],
        providers: [{ provide: RepositoryService, useValue: repositories }],
      }).compile();
      app = module.createNestApplication();
      await app.init();
      const preview = (path: string) =>
        request(app!.getHttpServer())
          .get(`/repositories/${repo.id}/file`)
          .query({ path });

      const failed = await preview('tracked.txt').expect(400);
      expect(failed.body.message).toBe('无法读取文件：远端文件连接已中断');
      const retried = await preview('tracked.txt').expect(200);
      expect(retried.body).toMatchObject({
        kind: 'text',
        content: 'original\n',
      });
      const switched = await preview('other.txt').expect(200);
      expect(switched.body).toMatchObject({
        kind: 'text',
        content: '另一个文件\n',
      });
      expect(connection.connected).toBe(true);
    } finally {
      await app?.close();
      connection?.disconnect();
      await remote?.close();
      db.close();
      fixture.close();
    }
  }, 15000);
});

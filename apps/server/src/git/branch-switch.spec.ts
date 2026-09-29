import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GitCommands, LocalConnection } from '@alune/ssh-client';
import type { SwitchBranchOptions } from '@alune/shared';
import { GitService } from './git.service';
import { GitController } from './git.controller';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';

const {
  createRepository,
} = require('../../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const {
  connectFixture,
} = require('../../../../packages/ssh-client/tests/helpers/ssh-server.cjs');

jest.setTimeout(30_000);

// The SSH fixture executes real Git through a loopback SSH server, with no user credentials.
describe.each(process.platform === 'win32' ? ['local'] : ['local', 'ssh'])(
  '%s branch switching',
  (source) => {
    let fixture: any;
    let ssh: any;
    let service: GitService;
    let commands: GitCommands;
    let app: any;
    let connect: jest.Mock;
    const id = '11111111-1111-4111-8111-111111111111';
    const git = (...args: string[]) => fixture.git(...args).trim();
    const switchTo = (name: string, options: SwitchBranchOptions = {}) =>
      service.switchBranch(id, name, options.localName, options.isRemote);
    const state = () => ({
      head: git('symbolic-ref', 'HEAD').replace(/^refs\/heads\//, ''),
      branches: git(
        'for-each-ref',
        '--format=%(refname)%00%(objectname)%00%(upstream)',
        'refs/heads',
      ),
      index: git('ls-files', '--stage'),
      contents: readFileSync(join(fixture.repo, 'tracked.txt'), 'utf8'),
    });

    beforeEach(async () => {
      fixture = createRepository();
      git('branch', '-M', 'main');
      const bare = join(fixture.root, 'remote.git');
      execFileSync('git', ['init', '-q', '--bare', bare]);
      git('remote', 'add', 'origin', bare);
      git('push', '-q', 'origin', 'HEAD:refs/heads/feature/demo');
      ssh = source === 'ssh' ? await connectFixture(fixture) : undefined;
      connect = jest.fn(async () => {
        if (!ssh)
          throw new Error('Local repositories must not connect over SSH');
        return ssh.connection;
      });
      service = new GitService(
        { ensureConnected: connect } as unknown as ConnectionService,
        {
          get: async () => ({
            path: fixture.repo,
            source,
            connectionId: source === 'ssh' ? 'host' : null,
          }),
        } as unknown as RepositoryService,
      );
      commands = new GitCommands(ssh?.connection || new LocalConnection());
      const module = await Test.createTestingModule({
        controllers: [GitController],
        providers: [{ provide: GitService, useValue: service }],
      }).compile();
      app = module.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await app?.close();
      await ssh?.close();
      fixture?.close();
    });

    it('creates a local tracking branch via HTTP and reuses it on repeated selection', async () => {
      const response = await request(app.getHttpServer())
        .post(`/repositories/${id}/switch`)
        .send({ name: 'remotes/origin/feature/demo', isRemote: true })
        .expect(201);
      expect(response.body).toMatchObject({
        success: true,
        branch: 'feature/demo',
      });
      expect(git('symbolic-ref', 'HEAD').replace(/^refs\/heads\//, '')).toBe(
        'feature/demo',
      );
      expect(git('rev-parse', '--abbrev-ref', '@{u}')).toBe(
        'origin/feature/demo',
      );
      await switchTo('main');
      await switchTo('refs/remotes/origin/feature/demo');
      await switchTo('remotes/origin/feature/demo');
      const branches = await commands.branchList(fixture.repo);
      expect(branches.filter((b) => !b.isRemote)).toHaveLength(2);
      expect(branches.find((b) => b.isCurrent)).toMatchObject({
        name: 'feature/demo',
        upstream: 'origin/feature/demo',
      });
      if (source === 'local') expect(connect).not.toHaveBeenCalled();
      else expect(connect).toHaveBeenCalled();
    });

    it('reuses differently named tracking branches before checking name collisions, preferring the current branch', async () => {
      git('branch', 'feature/demo');
      git('branch', '--track', 'renamed', 'origin/feature/demo');
      expect(await switchTo('remotes/origin/feature/demo')).toMatchObject({
        branch: 'renamed',
      });
      git('branch', '--track', 'another', 'origin/feature/demo');
      expect(await switchTo('remotes/origin/feature/demo')).toMatchObject({
        branch: 'renamed',
      });
      expect(git('branch', '--list').split('\n')).toHaveLength(4);
    });

    it.each([false, true])(
      'reports an existing branch conflict without changing its upstream (other upstream: %s)',
      async (otherUpstream) => {
        git('branch', 'feature/demo');
        if (otherUpstream) {
          git('remote', 'add', 'upstream', join(fixture.root, 'remote.git'));
          git('fetch', '-q', 'upstream');
          git(
            'branch',
            '--set-upstream-to=upstream/feature/demo',
            'feature/demo',
          );
        }
        const before = state();
        const { body } = await request(app.getHttpServer())
          .post(`/repositories/${id}/switch`)
          .send({ name: 'remotes/origin/feature/demo', isRemote: true })
          .expect(409);
        expect(body).toMatchObject({
          code: 'LOCAL_BRANCH_EXISTS',
          localName: 'feature/demo',
          remoteRef: 'refs/remotes/origin/feature/demo',
        });
        expect(body.upstream).toBe(
          otherUpstream ? 'refs/remotes/upstream/feature/demo' : undefined,
        );
        expect(state()).toEqual(before);
        // Explicitly choosing the existing branch must keep its original upstream.
        await switchTo(body.localName, { isRemote: false });
        expect(state().branches).toBe(before.branches);
      },
    );

    it('creates an alternate name from the selected remote and refuses to overwrite another existing name', async () => {
      git('branch', 'feature/demo');
      git('branch', 'taken');
      const before = state();
      await expect(
        switchTo('remotes/origin/feature/demo', { localName: 'taken' }),
      ).rejects.toMatchObject({ status: 409 });
      expect(state()).toEqual(before);
      const response = await request(app.getHttpServer())
        .post(`/repositories/${id}/switch`)
        .send({
          name: 'remotes/origin/feature/demo',
          isRemote: true,
          localName: 'feature/alternate',
        })
        .expect(201);
      expect(response.body.branch).toBe('feature/alternate');
      expect(git('rev-parse', '--abbrev-ref', '@{u}')).toBe(
        'origin/feature/demo',
      );
      expect(git('rev-parse', 'feature/demo')).toBe(git('rev-parse', 'main'));
    });

    it('uses the selected remote even with checkout.defaultRemote and slash-containing remote names', async () => {
      git('remote', 'add', 'team/upstream', join(fixture.root, 'remote.git'));
      git('fetch', '-q', 'team/upstream');
      git('config', 'checkout.defaultRemote', 'origin');
      await switchTo('remotes/team/upstream/feature/demo');
      expect(git('rev-parse', '--abbrev-ref', '@{u}')).toBe(
        'team/upstream/feature/demo',
      );
      await switchTo('main');
      await expect(
        switchTo('remotes/origin/feature/demo'),
      ).rejects.toMatchObject({ status: 409 });
      await switchTo('remotes/origin/feature/demo', {
        localName: 'origin-demo',
      });
      expect(git('rev-parse', '--abbrev-ref', '@{u}')).toBe(
        'origin/feature/demo',
      );
      expect(
        await switchTo('remotes/team/upstream/feature/demo'),
      ).toMatchObject({ branch: 'feature/demo' });
    });

    it('keeps literal local origin/ and remotes/ names distinct from remote refs', async () => {
      git('branch', 'origin/literal');
      await switchTo('origin/literal');
      expect(state().head).toBe('origin/literal');
      git('branch', 'remotes/origin/feature/demo');
      await switchTo('remotes/origin/feature/demo', { isRemote: false });
      expect(state().head).toBe('remotes/origin/feature/demo');
      await switchTo('remotes/origin/feature/demo', { isRemote: true });
      expect(state().head).toBe('feature/demo');
      expect(await commands.branchList(fixture.repo)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'remotes/origin/feature/demo',
            isRemote: false,
          }),
          expect.objectContaining({
            name: 'remotes/origin/feature/demo',
            isRemote: true,
          }),
        ]),
      );
    });

    it('rejects stale refs, remote HEAD aliases, invalid names and option injection without modifying files', async () => {
      git(
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/feature/demo',
      );
      fixture.write('tracked.txt', 'keep my work\n');
      const before = state();
      for (const name of [
        'remotes/origin/missing',
        'refs/remotes/origin/HEAD',
        '-f',
        'main~1',
        'missing',
      ])
        await expect(switchTo(name)).rejects.toThrow();
      for (const localName of ['-f', '@{-1}', 'bad..name', 'bad name'])
        await expect(
          switchTo('remotes/origin/feature/demo', { localName }),
        ).rejects.toThrow();
      expect(state()).toEqual(before);
      expect(
        (await commands.branchList(fixture.repo)).some((b) =>
          b.name.endsWith('/HEAD'),
        ),
      ).toBe(false);
    });

    it.each([false, true])(
      'preserves worktree, index and refs when checkout is blocked (existing tracking: %s)',
      async (existing) => {
        git('switch', '-qc', 'remote-edit');
        fixture.write('tracked.txt', 'remote change\n');
        git('commit', '-qam', 'remote edit');
        git('push', '-q', 'origin', 'HEAD:refs/heads/feature/demo');
        git('switch', '-q', 'main');
        git('branch', '-D', 'remote-edit');
        if (existing)
          git('branch', '--track', 'feature/demo', 'origin/feature/demo');
        fixture.write('tracked.txt', 'staged work\n');
        git('add', 'tracked.txt');
        fixture.write('tracked.txt', 'unstaged work\n');
        const before = state();
        await expect(switchTo('remotes/origin/feature/demo')).rejects.toThrow(
          /overwritten/,
        );
        expect(state()).toEqual(before);
        expect(service.operation(id)).toBeNull();
      },
    );

    it('preserves state and exposes a transport failure, releasing the write guard', async () => {
      const before = state();
      const failure = new Error(
        source === 'ssh' ? 'SSH connection lost' : 'Git unavailable',
      );
      if (source === 'ssh') connect.mockRejectedValueOnce(failure);
      else
        jest
          .spyOn(LocalConnection.prototype, 'execGit')
          .mockRejectedValueOnce(failure);
      await expect(switchTo('remotes/origin/feature/demo')).rejects.toThrow(
        failure.message,
      );
      expect(state()).toEqual(before);
      expect(service.operation(id)).toBeNull();
      await switchTo('remotes/origin/feature/demo');
    });
  },
);

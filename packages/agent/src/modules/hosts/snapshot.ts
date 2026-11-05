import {
  ProtocolError,
  isRecord,
  validateResource,
  type ResourceRef,
  type JsonValue,
} from '@alune/protocol';
import { GitReads } from '../git/git-commands';
import { pullRequestBranch } from '../git/pull-request-branch';
import { StagedChanges, StagedChangesError } from '../git/staged-changes';
import type { RepositoryTransport } from '../../ports/repository-files';
import type { RepositoryCatalog } from '../repositories/catalog';
import type { Handler } from '../../ports/handler';
import { isProviderError } from '../../ports/provider-error';

export interface SnapshotRequest {
  resource: ResourceRef;
  kind: 'remotes' | 'branch' | 'staged' | 'checkStaged';
  argument?: string;
}
export function snapshotHandler(
  catalog: RepositoryCatalog,
  connect: (s: AbortSignal) => Promise<RepositoryTransport>,
): Handler {
  return {
    minimumProtocolMinor: 6,
    effect: 'query',
    validate(v) {
      if (
        !isRecord(v) ||
        !['remotes', 'branch', 'staged', 'checkStaged'].includes(String(v.kind)) ||
        Object.keys(v).some((k) => !['resource', 'kind', 'argument'].includes(k)) ||
        (v.argument !== undefined &&
          (typeof v.argument !== 'string' ||
            v.argument.length > 1024 ||
            !['branch', 'checkStaged'].includes(String(v.kind)))) ||
        (v.kind === 'checkStaged' && !/^[a-f0-9]{64}$/.test(String(v.argument)))
      )
        throw new ProtocolError('invalid-params', 'Invalid repository snapshot request');
      validateResource(v.resource);
    },
    async run(v, c) {
      const { resource, kind, argument } = v as unknown as SnapshotRequest;
      const repo = catalog.get(resource),
        signal = AbortSignal.any([c.signal, c.sessionSignal, AbortSignal.timeout(60000)]);
      const conn = await connect(signal);
      try {
        const staged = new StagedChanges(conn, repo.path);
        switch (kind) {
          case 'remotes':
            return (await new GitReads(conn).remoteList(repo.path, signal)) as unknown as JsonValue;
          case 'branch':
            return await pullRequestBranch(conn, repo.path, argument, signal);
          case 'staged':
            return await staged.read(signal);
          case 'checkStaged':
            await staged.assertRevision(argument!, signal);
            return null;
        }
      } catch (e) {
        if (e instanceof StagedChangesError)
          throw new ProtocolError(
            e.statusCode === 413
              ? 'overloaded'
              : e.statusCode === 409
                ? 'conflict'
                : e.statusCode === 400
                  ? 'invalid-params'
                  : 'unavailable',
            e.message,
          );
        if (isProviderError(e))
          throw new ProtocolError('invalid-params', 'Invalid repository branch');
        throw e;
      } finally {
        await conn.close?.();
      }
    },
  };
}

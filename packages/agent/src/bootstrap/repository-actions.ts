import { ProtocolError, type RepositoryResource } from '@alune/protocol';
import type { BranchNameConflict } from '@alune/domain';
import { writeWorkspaceText } from '../adapters/files/workspace-text';
import { GitActions, type GitAction, type WriteCatalog } from '../modules/git/actions';
import { GitCommands } from '../modules/git/git-commands-writes';
import { InteractiveRebase } from '../modules/git/interactive-rebase';
import type { RepositoryTransport } from '../ports/repository-files';

class Invalid extends ProtocolError {
  constructor(message: string) {
    super('invalid-params', message);
  }
}
class Conflict extends ProtocolError {
  constructor(failure: string | BranchNameConflict) {
    super(
      'conflict',
      typeof failure === 'string' ? failure : failure.message,
      'not-started',
      typeof failure === 'string' ? undefined : JSON.parse(JSON.stringify(failure)),
    );
  }
}
class ActionFailure extends ProtocolError {
  constructor(message: string, status: number) {
    super(
      status === 409 ? 'conflict' : status === 400 ? 'invalid-params' : 'unavailable',
      message,
      'unknown',
    );
  }
}
export class Actions extends GitActions {
  constructor(
    registry: WriteCatalog,
    readonly repo: RepositoryResource,
    readonly transport: RepositoryTransport,
    readonly onKind: (kind: string) => void,
  ) {
    super(registry, { invalid: Invalid, conflict: Conflict, status: ActionFailure });
  }
  writeFile(id: string, path: string, content: string, token: string) {
    return this.write(id, 'write-file', (_git, repo, transport) =>
      writeWorkspaceText(transport, repo.path, path, content, token),
    );
  }
  protected async write<T>(_id: string, kind: string, operation: GitAction<T>) {
    this.onKind(kind);
    if (
      ![
        'stage',
        'unstage',
        'interactive-rebase',
        'rebase-conflict',
        'resolve-conflict',
        'conflict-continue',
        'conflict-skip',
        'conflict-abort',
      ].includes(kind) &&
      (await new InteractiveRebase(this.transport).state(this.repo.path)).managed
    )
      throw new Conflict('请先完成或中止当前交互式变基。');
    return operation(new GitCommands(this.transport), this.repo, this.transport);
  }
}

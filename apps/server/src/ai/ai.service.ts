import { Injectable, Optional } from '@nestjs/common';
import { AiService as Core } from '@alune/agent/ai';
import { StagedChanges, LocalConnection } from '@alune/ssh-client';
import { ConnectionService } from '../connection/connection.service';
import { RepositoryService } from '../repository/repository.service';
import { PullRequestCreationService } from '../repository/pull-request-creation.service';
import { AiSettingsStore } from './ai-settings';
import { ProxyService } from '../proxy/proxy.service';
import { traceHttp } from '../logging/logger';

@Injectable()
export class AiService extends Core {
  constructor(
    settings: AiSettingsStore,
    connections: ConnectionService,
    repositories: RepositoryService,
    @Optional() proxy?: ProxyService,
    @Optional() creation?: PullRequestCreationService,
  ) {
    super(
      settings,
      async (id, signal) => {
        const repo = await repositories.get(id);
        const connection =
          repo.source === 'local'
            ? new LocalConnection(
                signal,
                proxy ? () => proxy.settings.snapshot() : undefined,
              )
            : await connections.ensureConnected(repo.connectionId!);
        return {
          staged: new StagedChanges(connection, repo.path),
          release: 'holdTask' in connection ? connection.holdTask() : () => {},
        };
      },
      proxy?.fetch,
      creation,
      traceHttp,
    );
  }
}

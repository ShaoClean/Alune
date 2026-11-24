import { Button, Radio, Switch } from '@alune/ui';
import { useBackgroundSyncStore } from '../../stores/backgroundSyncStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { repositoryAccessibleName } from '../../stores/repositoryLabels';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

const intervals = [5, 10, 30].map((value) => ({ value, label: `${value} 分钟` }));

export function RepositorySyncSettings() {
  const { enabled, intervalMinutes, excludedRepositoryIds } = useWorkspaceStore(
    (state) => state.backgroundSync,
  );
  const update = useWorkspaceStore((state) => state.updateBackgroundSync);
  const repositories = useRepositoryStore((state) => state.repositories);
  const loading = useRepositoryStore((state) => state.listLoading);
  const error = useRepositoryStore((state) => state.listError);
  const reload = useRepositoryStore((state) => state.fetchRepositories);
  const connections = useConnectionStore((state) => state.connections);
  const fetchStates = useBackgroundSyncStore((state) => state.fetchStates);

  const setRepositoryEnabled = (id: string, include: boolean) => {
    const ids = useWorkspaceStore.getState().backgroundSync.excludedRepositoryIds;
    update({
      excludedRepositoryIds: include ? ids.filter((item) => item !== id) : [...ids, id],
    });
  };

  return (
    <div className="settings-page-content">
      <h1>仓库同步</h1>
      <p className="settings-lead">
        后台获取更新远程跟踪引用。发现新提交时，可从底栏通知发起拉取。
      </p>
      <fieldset className="settings-fieldset appearance-preferences">
        <label className="settings-inline-actions">
          <Switch
            aria-label="自动获取远程更新"
            checked={enabled}
            onChange={(value) => update({ enabled: value })}
          />
          自动获取远程更新
        </label>
        <h2 id="sync-interval-label" className="settings-subheading">
          获取间隔
        </h2>
        <Radio.Group
          aria-labelledby="sync-interval-label"
          options={intervals}
          value={intervalMinutes}
          onChange={(event) => update({ intervalMinutes: event.target.value })}
        />
        <h2 id="sync-repositories-label" className="settings-subheading">
          参与自动获取的仓库
        </h2>
        <p className="settings-field-hint">总开关开启后，此处开启的仓库会自动获取更新。</p>
        {error && (
          <div className="settings-inline-actions" role="status">
            <span>无法读取仓库列表。{error}</span>
            <Button size="small" loading={loading} onClick={() => void reload()}>
              重试
            </Button>
          </div>
        )}
        {repositories.length ? (
          <ul className="sync-settings-repositories" aria-labelledby="sync-repositories-label">
            {repositories.map((repo) => {
              const source = repo.connectionId
                ? connections.find((connection) => connection.id === repo.connectionId)?.name ||
                  'SSH'
                : '本机';
              const included = !excludedRepositoryIds.includes(repo.id);
              const state = enabled && included ? fetchStates[repo.id] : undefined;
              return (
                <li className="sync-settings-repository" key={repo.id}>
                  <div className="sync-settings-repository__identity">
                    <strong>{repo.name}</strong>
                    <div
                      className="sync-settings-repository__path"
                      title={`${source} · ${repo.path}`}
                    >
                      {source} · {repo.path}
                    </div>
                    {(state?.phase === 'error' || state?.phase === 'paused') && (
                      <div className="sync-settings-repository__detail">
                        {state.phase === 'error' ? '获取失败' : '已暂停'}
                        {state.reason && ` · ${state.reason}`}
                      </div>
                    )}
                  </div>
                  <Switch
                    size="small"
                    aria-label={`自动获取远程更新 · ${repositoryAccessibleName(repo, source)}`}
                    checked={included}
                    onChange={(include) => setRepositoryEnabled(repo.id, include)}
                  />
                </li>
              );
            })}
          </ul>
        ) : !error ? (
          <p className="settings-field-hint" role="status">
            {loading ? '正在读取仓库列表…' : '尚未登记仓库。'}
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Spin, Tag } from 'antd';
import { ExportOutlined, PullRequestOutlined, ReloadOutlined } from '@ant-design/icons';
import type {
  PullRequestFilter,
  PullRequestItem,
  PullRequestPage,
  PullRequestProvider,
  PullRequestRemote,
} from '@alune/shared';
import { repositoryApi } from '../api';
import { errorMessage } from './files-tree';
import { PanelHeader } from './ui';

export function defaultPullRequestRemote(remotes: PullRequestRemote[]): string {
  return (
    (
      remotes.find((remote) => remote.name === 'origin' && !remote.unavailableReason) ||
      remotes.find((remote) => remote.provider && !remote.unavailableReason) ||
      remotes.find((remote) => !remote.unavailableReason) ||
      remotes[0]
    )?.name || ''
  );
}

export function PullRequestRow({
  item,
  provider,
}: {
  item: PullRequestItem;
  provider: PullRequestProvider;
}) {
  const labels = { open: '开放中', closed: '已关闭', merged: '已合并' };
  return (
    <li className="pull-request-row">
      <PullRequestOutlined
        className={`pull-request-row__icon pull-request-row__icon--${item.state}`}
        aria-hidden
      />
      <div className="pull-request-row__body">
        <div className="pull-request-row__title">
          <a href={item.url} target="_blank" rel="noopener noreferrer" title="在浏览器中查看详情">
            {item.title} <ExportOutlined aria-label="在浏览器中打开" />
          </a>
          <Tag
            color={item.state === 'merged' ? 'purple' : item.state === 'open' ? 'green' : 'default'}
          >
            {labels[item.state]}
          </Tag>
          {item.draft && <Tag>草稿</Tag>}
        </div>
        <div className="pull-request-row__meta">
          <span>
            {provider === 'github' ? '#' : '!'}
            {item.number}
          </span>
          <span>{item.author}</span>
          <span
            className="pull-request-row__branches"
            title={`${item.sourceBranch} → ${item.targetBranch}`}
          >
            {item.sourceBranch || '已删除分支'} → {item.targetBranch || '未知分支'}
          </span>
          <time dateTime={item.updatedAt}>
            更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
          </time>
        </div>
      </div>
    </li>
  );
}

function RemotePullRequests({
  repoId,
  remote,
  refreshToken,
}: {
  repoId: string;
  remote: PullRequestRemote;
  refreshToken: number;
}) {
  const [provider, setProvider] = useState<PullRequestProvider | null>(remote.provider);
  const [state, setState] = useState<PullRequestFilter>('open');
  const [page, setPage] = useState(1);
  const [tokenDraft, setTokenDraft] = useState('');
  const [credential, setCredential] = useState({ token: '', revision: 0 });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: PullRequestPage } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const key = JSON.stringify([provider, state, page, credential.revision]);
  const data = result?.key === key ? result.data : null;

  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void repositoryApi
      .pullRequests(
        repoId,
        {
          remote: remote.name,
          target: remote.webUrl,
          provider,
          state,
          page,
          ...(credential.token ? { token: credential.token } : {}),
        },
        controller.signal,
      )
      .then((response) => {
        if (!controller.signal.aborted) setResult({ key, data: response });
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure, '无法读取 PR/MR，请重试。'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    repoId,
    remote.name,
    remote.webUrl,
    provider,
    state,
    page,
    credential,
    key,
    refreshToken,
    retry,
  ]);

  const applyToken = (token: string) => {
    setCredential((value) => ({ token: token.trim(), revision: value.revision + 1 }));
    setTokenDraft('');
    setPage(1);
  };

  return (
    <div className="pull-requests-content">
      <div className="pull-requests-filters">
        <a
          className="pull-requests-project"
          href={remote.webUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {remote.host}/{remote.project} <ExportOutlined />
        </a>
        {!remote.provider ? (
          <Select
            aria-label="托管平台"
            placeholder="选择托管平台"
            value={provider || undefined}
            onChange={setProvider}
            options={[{ value: 'gitlab', label: 'GitLab（自建）' }]}
          />
        ) : (
          <span className="pull-requests-provider">
            {provider === 'github' ? 'GitHub' : 'GitLab'}
          </span>
        )}
        <Select
          aria-label="PR/MR 状态"
          value={state}
          disabled={!provider}
          onChange={(value) => {
            setState(value);
            setPage(1);
          }}
          options={[
            { value: 'open', label: '开放中' },
            { value: 'all', label: '全部状态' },
          ]}
        />
      </div>
      {!provider ? (
        <Alert
          type="info"
          showIcon
          title="无法自动识别此主机的平台"
          description="如果这是使用 HTTPS 的自建 GitLab，请在上方选择平台后读取 MR。暂不支持其他自建托管平台或 SSH 主机别名。"
        />
      ) : (
        <>
          <details className="pull-requests-auth">
            <summary>访问令牌（可选）{credential.token && <span> · 已应用</span>}</summary>
            <p>
              公开仓库可直接读取。令牌仅用于 {remote.host}
              ，离开此视图或切换远端后清除，不保存到磁盘。
            </p>
            <p>
              {provider === 'github'
                ? 'GitHub：细粒度令牌需要此仓库的 Pull requests 读取权限；经典令牌需要 repo 权限。组织仓库可能需要 SSO 授权。'
                : 'GitLab：使用有项目访问权且包含 read_api 或 api 权限的个人、项目或群组访问令牌。'}
            </p>
            <form
              className="pull-requests-auth__form"
              onSubmit={(event) => {
                event.preventDefault();
                applyToken(tokenDraft);
              }}
            >
              <Input.Password
                aria-label="访问令牌"
                placeholder="输入访问令牌"
                autoComplete="off"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
              />
              <Button htmlType="submit" disabled={!tokenDraft.trim()}>
                应用令牌
              </Button>
              {credential.token && <Button onClick={() => applyToken('')}>清除令牌</Button>}
            </form>
          </details>
          {error && (
            <Alert
              type="error"
              showIcon
              title={error}
              description={data ? '当前仍显示上次读取的结果。' : undefined}
              action={
                <Button size="small" onClick={() => setRetry((value) => value + 1)}>
                  重试
                </Button>
              }
            />
          )}
          <div className="pull-requests-results" aria-busy={loading}>
            {loading && (
              <div className="pull-requests-loading" role="status">
                <Spin size="small" /> 正在读取 PR/MR…
              </div>
            )}
            {data?.items.length ? (
              <ul className="pull-request-list" aria-label="PR/MR 列表">
                {data.items.map((item) => (
                  <PullRequestRow key={item.number} item={item} provider={provider} />
                ))}
              </ul>
            ) : data && !loading && !error ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={state === 'open' ? '此远端暂无开放中的 PR/MR' : '此页暂无 PR/MR'}
              />
            ) : null}
          </div>
          <div className="pull-requests-pagination">
            <span aria-live="polite">
              第 {page} 页{data ? ` · ${data.items.length} 条` : ''}
            </span>
            <Button disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)}>
              上一页
            </Button>
            <Button
              disabled={!data?.hasMore || loading || Boolean(error)}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function PullRequestsView({
  repoId,
  refreshToken = 0,
}: {
  repoId: string;
  refreshToken?: number;
}) {
  const [remotes, setRemotes] = useState<PullRequestRemote[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void repositoryApi
      .pullRequestRemotes(repoId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setRemotes(response);
        setSelected((current) =>
          response.some((remote) => remote.name === current)
            ? current
            : defaultPullRequestRemote(response),
        );
        setLoaded(true);
        setListRefresh((value) => value + 1);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure, '无法读取远端，请重试。'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [repoId, refresh, refreshToken]);

  const remote = remotes.find((item) => item.name === selected);
  return (
    <section className="workspace-panel pull-requests-view" aria-label="仓库 PR/MR">
      <PanelHeader
        title="PR/MR"
        description="所选远端仓库收到的合并请求 · 按最近更新排序"
        icon={<PullRequestOutlined />}
        extra={
          <Button
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => setRefresh((value) => value + 1)}
            aria-label="刷新 PR/MR"
          >
            刷新
          </Button>
        }
      />
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button size="small" onClick={() => setRefresh((value) => value + 1)}>
              重试远端
            </Button>
          }
        />
      )}
      {loading && !loaded && (
        <div className="pull-requests-loading" role="status">
          <Spin size="small" /> 正在读取远端…
        </div>
      )}
      {remotes.length > 0 && (
        <div className="pull-requests-remote">
          <label htmlFor="pull-request-remote">远端</label>
          <Select
            id="pull-request-remote"
            aria-label="PR/MR 远端"
            value={selected}
            onChange={setSelected}
            options={remotes.map((item) => ({
              value: item.name,
              label: `${item.name}${item.host ? ` · ${item.host}` : ''}`,
            }))}
          />
        </div>
      )}
      {remote?.unavailableReason ? (
        <Alert type="info" showIcon title={remote.unavailableReason} />
      ) : remote ? (
        <RemotePullRequests
          key={`${repoId}:${remote.name}:${remote.webUrl}`}
          repoId={repoId}
          remote={remote}
          refreshToken={listRefresh}
        />
      ) : loaded && !error && !loading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="此仓库尚未配置远端" />
      ) : null}
    </section>
  );
}

import { usePullRequestCenter } from '../stores/pullRequestCenter';
import { CreatePullRequestDialog } from './CreatePullRequestDialog';
import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceLocation } from '../hooks/useRepositoryWorkspace';
import { Button, DialogIcon, Empty, Input, Segmented, Select, Spin, Tag } from '@alune/ui';
import { FeedbackNotice } from '@alune/ui';
import type {
  PullRequestFilter,
  PullRequestItem,
  PullRequestPage,
  PullRequestProvider,
  PullRequestRemote,
} from '@alune/shared';
import { repositoryApi } from '../api';
import { errorMessage } from './files-tree';
import { ErrorState, PanelHeader } from '@alune/ui';
import { useAccessTokensStore } from '../stores/accessTokensStore';
import { PullRequestDetails } from './PullRequestDetails';
import { PullRequestBranches, PullRequestStatus } from './PullRequestPresentation';

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
  onOpen,
}: {
  item: PullRequestItem;
  provider: PullRequestProvider;
  onOpen: (number: number) => void;
}) {
  return (
    <li className="pull-request-row">
      <span className={`pull-request-row__icon pull-request-row__icon--${item.state}`}>
        <DialogIcon name={item.state === 'merged' ? 'merge' : 'pr'} />
      </span>
      <div className="pull-request-row__body">
        <div className="pull-request-row__title">
          <button
            type="button"
            className="pull-request-row__open"
            onClick={() => onOpen(item.number)}
          >
            {item.title}
          </button>
          {item.draft && <Tag>草稿</Tag>}
        </div>
        <div className="pull-request-row__meta">
          <span>
            {provider === 'github' ? '#' : '!'}
            {item.number}
          </span>
          <span>{item.author}</span>
          <PullRequestBranches {...item} />
        </div>
      </div>
      <div className="pull-request-row__aside">
        <PullRequestStatus state={item.state} />
        <time
          dateTime={item.updatedAt}
          title={new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
        >
          更新于 {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
        </time>
      </div>
      <a
        className="pull-request-row__external"
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="在浏览器中打开"
        title="在浏览器中打开"
      >
        <DialogIcon name="arrow-up-right" />
      </a>
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
  const navigate = useNavigate();
  const location = useWorkspaceLocation();
  const message = useFeedbackMessage();
  const [creating, setCreating] = useState(
    () => new URLSearchParams(location.search).get('createPr') === '1',
  );
  const sourceBranch = new URLSearchParams(location.search).get('sourceBranch') || undefined;
  const closeCreate = () => {
    setCreating(false);
    const params = new URLSearchParams(location.search);
    params.delete('createPr');
    params.delete('sourceBranch');
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  };
  const {
    settings,
    loading: tokensLoading,
    error: tokensError,
    load,
    accept,
    choice,
  } = useAccessTokensStore();
  const selection = remote.selection;
  const [provider, setProvider] = useState<PullRequestProvider | null>(
    remote.provider || selection?.provider || null,
  );
  const centerRevision = usePullRequestCenter((s) => s.revision);
  const [state, setState] = useState<PullRequestFilter>('open');
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<number | null>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('createPr') === '1') {
      setOpened(null);
      setCreating(true);
    }
  }, [location.search]);
  const [tokenDraft, setTokenDraft] = useState('');
  const [credential, setCredential] = useState<{ token: string | null; revision: number }>({
    token: null,
    revision: 0,
  });
  const [tokenId, setTokenId] = useState<string | null>(selection?.tokenId || null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: PullRequestPage } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accessOpen, setAccessOpen] = useState(false);
  const key = JSON.stringify([provider, state, page, credential.revision, selection?.version]);
  const data = result?.key === key ? result.data : null;
  const invalidSelection =
    selection?.status === 'target-changed' || selection?.status === 'token-deleted';
  const selectedToken = settings?.tokens.find((t) => t.id === tokenId);
  const appliedToken = settings?.tokens.find((t) => t.id === selection?.tokenId);
  const accessLabel = invalidSelection
    ? '需要重新关联'
    : credential.token !== null
      ? credential.token
        ? '临时令牌'
        : '未使用令牌'
      : appliedToken?.name || '未使用令牌';
  const dirty =
    tokenId !== (selection?.tokenId || null) ||
    provider !== selection?.provider ||
    selection?.status !== 'applied' ||
    credential.token !== null;
  const manage = () =>
    navigate('/settings/tokens', {
      state: {
        returnTo: `/repositories/${repoId}?${new URLSearchParams({ panel: 'pull-requests', remote: remote.name })}`,
        tokenReturn: { repositoryId: repoId, remote: remote.name, target: remote.webUrl },
      },
    });

  useEffect(() => {
    if (invalidSelection || !provider || error || tokensError || applyError) setAccessOpen(true);
  }, [invalidSelection, provider, error, tokensError, applyError]);

  useEffect(() => {
    setTokenId(selection?.tokenId || null);
    setProvider(remote.provider || selection?.provider || null);
    setCredential((current) => ({ token: null, revision: current.revision + 1 }));
    setTokenDraft('');
    setApplyError('');
  }, [selection?.version, remote.provider]);

  useEffect(() => {
    if (
      choice?.repositoryId === repoId &&
      choice.remote === remote.name &&
      choice.target === remote.webUrl
    ) {
      setTokenId(choice.tokenId);
      setAccessOpen(true);
      useAccessTokensStore.setState({ choice: null });
    }
  }, [choice, repoId, remote.name, remote.webUrl]);

  const applySaved = async () => {
    if (!provider || !settings || applying) return;
    setApplying(true);
    setApplyError('');
    try {
      accept(
        await repositoryApi.applyAccessToken(repoId, {
          remote: remote.name,
          target: remote.webUrl,
          provider,
          tokenId,
          revision: settings.revision,
        }),
      );
      setTokenDraft('');
      setPage(1);
    } catch (failure) {
      setApplyError(errorMessage(failure, '无法保存仓库关联，请重试。'));
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    if (!provider || (invalidSelection && credential.token === null)) {
      setLoading(false);
      return;
    }
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
          ...(credential.token !== null ? { token: credential.token } : {}),
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
    invalidSelection,
    centerRevision,
  ]);

  const applyToken = (token: string) => {
    setCredential((value) => ({ token: token.trim(), revision: value.revision + 1 }));
    setTokenDraft('');
    setPage(1);
  };

  if (opened !== null && provider && (!invalidSelection || credential.token !== null)) {
    return (
      <PullRequestDetails
        key={JSON.stringify([
          repoId,
          remote.name,
          remote.webUrl,
          provider,
          opened,
          credential.revision,
          selection?.version,
        ])}
        repoId={repoId}
        remote={remote}
        provider={provider}
        number={opened}
        token={credential.token}
        items={data?.items || []}
        refreshToken={refreshToken}
        onOpen={setOpened}
        onBack={() => {
          setOpened(null);
          setRetry((value) => value + 1);
        }}
        onChanged={() => {
          setRetry((value) => value + 1);
          usePullRequestCenter.getState().invalidate();
        }}
      />
    );
  }

  return (
    <div className="pull-requests-content">
      {creating && provider && (!invalidSelection || credential.token !== null) && (
        <CreatePullRequestDialog
          repoId={repoId}
          query={{
            remote: remote.name,
            target: remote.webUrl,
            provider,
            sourceBranch,
            ...(credential.token !== null ? { token: credential.token } : {}),
          }}
          onClose={closeCreate}
          onExisting={(number) => {
            closeCreate();
            setOpened(number);
          }}
          onCreated={(result) => {
            closeCreate();
            if (result.warning) message.warning(result.warning);
            setOpened(result.item.number);
            setRetry((value) => value + 1);
          }}
        />
      )}
      <div className="pull-requests-intro">
        <div className="pull-requests-project-info">
          <span className="pull-requests-provider">
            {provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : '托管平台待确认'}
            <span aria-hidden="true"> · </span>
            {remote.host}
          </span>
          <h2>
            <a
              className="pull-requests-project"
              href={remote.webUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {remote.project} <DialogIcon name="arrow-up-right" />
            </a>
          </h2>
          <p>审阅代码、跟进讨论与合并进度</p>
        </div>
        <Button
          type="text"
          className="pull-requests-access-toggle"
          icon={<DialogIcon name="key" />}
          aria-expanded={accessOpen}
          aria-controls="pull-requests-access"
          onClick={() => setAccessOpen((value) => !value)}
        >
          访问设置 <DialogIcon name="caret" />
        </Button>
      </div>
      <div id="pull-requests-access" className="pull-requests-access" hidden={!accessOpen}>
        <div className="pull-requests-access__core">
          <div className="pull-requests-access__heading">
            <strong>仓库访问</strong>
            <span title={accessLabel}>{accessLabel}</span>
          </div>
          {!remote.provider ? (
            <Select
              className="pull-requests-platform-select"
              aria-label="托管平台"
              placeholder="选择托管平台"
              value={provider || undefined}
              onChange={setProvider}
              options={[{ value: 'gitlab', label: 'GitLab（自建）' }]}
            />
          ) : null}
          <div className="pull-requests-token-bar">
            <label htmlFor="saved-access-token">访问令牌</label>
            <Select
              id="saved-access-token"
              aria-label="选择命名令牌"
              showSearch
              optionFilterProp="label"
              value={tokenId || ''}
              disabled={!provider || applying || !settings}
              onChange={(id) => {
                setTokenId(id || null);
                setApplyError('');
              }}
              options={[
                { value: '', label: '不使用令牌' },
                ...(settings?.tokens.map((token) => {
                  const mismatch =
                    token.scope &&
                    (token.scope.provider !== provider ||
                      token.scope.origin !== new URL(remote.webUrl).origin);
                  return {
                    value: token.id,
                    label: `${token.name}${mismatch ? ` · 仅适用 ${token.scope!.origin}` : ''}`,
                    disabled: !!mismatch,
                  };
                }) || []),
              ]}
            />
            <Button
              type={dirty ? 'primary' : 'default'}
              disabled={!provider || !settings || (!dirty && !applying)}
              loading={applying}
              onClick={() => void applySaved()}
            >
              {dirty ? '应用到此仓库' : '已记住选择'}
            </Button>
            <Button type="link" onClick={manage}>
              {settings && !settings.tokens.length ? '去添加令牌' : '管理令牌'}
            </Button>
            {selectedToken && !selectedToken.scope && (
              <p>
                首次应用时，“{selectedToken.name}”将关联到 {remote.host}。
              </p>
            )}
            {credential.token !== null && (
              <FeedbackNotice
                source="pr-session-token"
                type="info"
                title="正在使用仅本次输入的令牌，已保存的仓库关联保持不变。"
              />
            )}
          </div>
          {provider && (
            <details className="pull-requests-auth">
              <summary>仅本次输入{credential.token && <span> · 已应用</span>}</summary>
              <p>
                公开仓库可直接读取。令牌仅用于 {remote.host}
                ，离开此视图或切换远端后清除，不保存到磁盘。
              </p>
              <p>
                {provider === 'github'
                  ? 'GitHub：细粒度令牌需要此仓库的 Pull requests 读写权限（仅查看时可用读取权限）；预览分支改动及读取模板还需要 Contents 读取权限；经典令牌需要 repo 权限。组织仓库可能需要 SSO 授权。'
                  : 'GitLab：使用有项目访问权且包含 read_api（仅查看）或 api（评论及状态操作）权限的个人、项目或群组访问令牌。'}
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
                {credential.token !== null && (
                  <Button
                    onClick={() => {
                      setCredential((current) => ({ token: null, revision: current.revision + 1 }));
                      setTokenDraft('');
                    }}
                  >
                    恢复已保存的选择
                  </Button>
                )}
              </form>
            </details>
          )}
        </div>
      </div>
      <FeedbackNotice
        source="pr-selection"
        context={`${remote.name} · ${remote.host}/${remote.project}`}
        type="warning"
        mode="notification"
        eventKey={selection?.version}
        title={invalidSelection ? '访问令牌关联已失效' : null}
        description={
          selection?.status === 'token-deleted'
            ? '原令牌已删除，请重新选择并应用。'
            : '远端目标已变化，请确认上方主机与项目，重新选择并应用。'
        }
        actionLabel="管理令牌"
        onAction={manage}
      />
      <FeedbackNotice
        source="pr-tokens"
        context={remote.name}
        title={tokensError ? '无法读取访问令牌' : null}
        description={tokensError}
        actionLabel="重新加载令牌"
        busy={tokensLoading}
        onAction={load}
      />
      <FeedbackNotice
        source="pr-token-apply"
        context={remote.name}
        title={applyError ? '无法关联访问令牌' : null}
        description={applyError}
        actionLabel="重新应用"
        busy={applying}
        onAction={applySaved}
      />
      {!provider ? (
        <FeedbackNotice
          source="pr-platform"
          context={remote.name}
          type="info"
          mode="manual"
          title="无法自动识别此主机的平台"
          description="如果这是使用 HTTPS 的自建 GitLab，请在上方选择平台后读取 MR。暂不支持其他自建托管平台或 SSH 主机别名。"
        />
      ) : (
        <>
          <div className="pull-requests-filters">
            <Segmented<PullRequestFilter>
              aria-label="PR/MR 状态"
              value={state}
              onChange={(value) => {
                setState(value);
                setPage(1);
              }}
              options={[
                { value: 'open', label: '开放中' },
                { value: 'all', label: '全部状态' },
              ]}
            />
            <span className="pull-requests-sort">按最近更新排序</span>
            <Button
              type="primary"
              icon={<DialogIcon name="pr" />}
              disabled={invalidSelection && credential.token === null}
              onClick={() => setCreating(true)}
            >
              创建 PR/MR
            </Button>
          </div>
          <FeedbackNotice
            source="pull-requests"
            context={`${remote.name} · ${remote.host}/${remote.project}`}
            title={error ? 'PR/MR 读取失败' : null}
            description={[error, data ? '当前仍显示上次读取的结果。' : '']
              .filter(Boolean)
              .join('\n')}
            actionLabel="重试"
            busy={loading}
            onAction={() => setRetry((value) => value + 1)}
          />
          <div className="pull-requests-results-shell">
            <div className="pull-requests-results" aria-busy={loading}>
              {loading && (
                <div className="pull-requests-loading" role="status">
                  <Spin size="small" /> 正在读取 PR/MR…
                </div>
              )}
              {!data && error && !loading && (
                <ErrorState
                  announce={false}
                  title="无法读取 PR/MR"
                  description="可重试，或检查此远端的访问令牌。"
                  onRetry={() => setRetry((value) => value + 1)}
                />
              )}
              {data?.items.length ? (
                <ul className="pull-request-list" aria-label="PR/MR 列表">
                  {data.items.map((item) => (
                    <PullRequestRow
                      key={item.number}
                      item={item}
                      provider={provider}
                      onOpen={setOpened}
                    />
                  ))}
                </ul>
              ) : data && !loading && !error ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={state === 'open' ? '此远端暂无开放中的 PR/MR' : '此页暂无 PR/MR'}
                />
              ) : null}
            </div>
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
  const location = useWorkspaceLocation();
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get('remote') || '',
  );
  const { settings, load } = useAccessTokensStore();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);

  useEffect(() => {
    void load();
  }, [load]);

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
  }, [repoId, refresh, refreshToken, settings?.revision]);

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('remote');
    if (requested && remotes.some((item) => item.name === requested)) setSelected(requested);
  }, [location.search]);

  const remote = remotes.find((item) => item.name === selected);
  return (
    <section className="workspace-panel pull-requests-view" aria-label="仓库 PR/MR">
      <PanelHeader
        title="PR/MR"
        icon={<DialogIcon name="pr" />}
        extra={
          <>
            {remotes.length > 0 && (
              <div className="pull-requests-remote">
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
            <Button
              type="text"
              icon={<DialogIcon name="refresh" />}
              loading={loading}
              onClick={() => setRefresh((value) => value + 1)}
              aria-label="刷新 PR/MR"
            >
              刷新
            </Button>
          </>
        }
      />
      <FeedbackNotice
        source="pr-remotes"
        title={error ? '远端列表读取失败' : null}
        description={error}
        actionLabel="重试远端"
        busy={loading}
        onAction={() => setRefresh((value) => value + 1)}
      />
      {!loaded && error && !loading && (
        <ErrorState
          announce={false}
          title="无法读取远端列表"
          description={error}
          onRetry={() => setRefresh((value) => value + 1)}
        />
      )}
      {loading && !loaded && (
        <div className="pull-requests-loading" role="status">
          <Spin size="small" /> 正在读取远端…
        </div>
      )}
      {remote?.unavailableReason ? (
        <FeedbackNotice
          source="pr-unavailable"
          context={remote.name}
          type="info"
          mode="manual"
          title="远端不可用"
          description={remote.unavailableReason}
        />
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

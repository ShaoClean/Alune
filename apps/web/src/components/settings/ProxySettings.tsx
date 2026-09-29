import { FeedbackNotice } from '../Feedback';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Switch, Tag } from 'antd';
import {
  ApiOutlined,
  CloudServerOutlined,
  GlobalOutlined,
  ReloadOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons';
import { useBlocker, useNavigate } from 'react-router-dom';
import type {
  NetworkProxyConfig,
  ProxyConnectionStatus,
  ProxyTestResult,
  Repository,
  SaveNetworkProxy,
} from '@alune/shared';
import { proxyApi, proxyError } from '../../api/proxy';
import { repositoryApi } from '../../api';

const draftOf = (settings: NetworkProxyConfig): SaveNetworkProxy => ({
  revision: settings.revision,
  enabled: settings.enabled,
  protocol: settings.protocol,
  host: settings.host,
  port: settings.port,
  authEnabled: settings.authEnabled,
  credentials: { action: 'keep' },
});
const forwardingLabels: Record<ProxyConnectionStatus['forwarding'], string> = {
  disabled: '代理关闭',
  disconnected: '未连接',
  preparing: '准备中',
  ready: '可用',
  interrupted: '连接中断',
  denied: '禁止转发',
  error: '转发不可用',
};
type TestKind = 'http' | 'ssh' | 'git';

export function ProxySettings() {
  const navigate = useNavigate();
  const [saved, setSaved] = useState<NetworkProxyConfig>();
  const [draft, setDraft] = useState<SaveNetworkProxy>();
  const [servers, setServers] = useState<ProxyConnectionStatus[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [reconnecting, setReconnecting] = useState<string>();
  const [url, setUrl] = useState('https://github.com');
  const [connectionId, setConnectionId] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [results, setResults] = useState<Partial<Record<TestKind, ProxyTestResult>>>({});
  const [testing, setTesting] = useState<Partial<Record<TestKind, boolean>>>({});
  const [outdated, setOutdated] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const epoch = useRef(0);
  const controllers = useRef<Partial<Record<TestKind, AbortController>>>({});
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const dirty = Boolean(saved && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(saved)));
  const blocker = useBlocker(dirty || busy);
  const invalidate = () => {
    epoch.current++;
    Object.values(controllers.current).forEach((controller) => controller?.abort());
    controllers.current = {};
    setTesting({});
    setResults({});
  };
  const accept = (config: NetworkProxyConfig) => {
    setShowPassword(false);
    invalidate();
    setSaved(config);
    setDraft(draftOf(config));
    setOutdated(false);
  };
  const load = async () => {
    setBusy(true);
    try {
      const [config, connections, repos] = await Promise.all([
        proxyApi.settings(),
        proxyApi.connections(),
        repositoryApi.list(),
      ]);
      accept(config);
      setServers(connections);
      setRepositories(repos);
      setNotice(undefined);
    } catch (error) {
      setNotice({ error: true, text: proxyError(error) });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    let mounted = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      const baseline = savedRef.current?.revision;
      void Promise.all([proxyApi.connections(), proxyApi.settings()])
        .then(([connections, config]) => {
          if (!mounted) return;
          setServers(connections);
          setStatusError(false);
          if (baseline && savedRef.current?.revision === baseline && config.revision !== baseline) {
            invalidate();
            setOutdated(true);
          }
        })
        .catch(() => {
          if (mounted) setStatusError(true);
        })
        .finally(() => {
          polling = false;
        });
    }, 3000);
    return () => {
      mounted = false;
      clearInterval(timer);
      epoch.current++;
      Object.values(controllers.current).forEach((controller) => controller?.abort());
    };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, busy]);
  const change = (patch: Partial<SaveNetworkProxy>) => {
    invalidate();
    setNotice(undefined);
    setDraft((value) => value && { ...value, ...patch });
  };
  const save = async () => {
    if (!draft) return false;
    setBusy(true);
    setNotice(undefined);
    try {
      accept(await proxyApi.save(draft));
      setNotice({
        error: false,
        text: '代理配置已保存。本机新请求立即生效，已有 SSH 连接需手动重新连接。',
      });
      void proxyApi
        .connections()
        .then(setServers)
        .catch(() => {});
      return true;
    } catch (error) {
      setNotice({ error: true, text: proxyError(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const test = async (kind: TestKind) => {
    if (!saved) return;
    const current = epoch.current;
    const controller = new AbortController();
    controllers.current[kind] = controller;
    setResults((value) => ({ ...value, [kind]: undefined }));
    setTesting((value) => ({ ...value, [kind]: true }));
    try {
      const result = await proxyApi.test(
        { kind, revision: saved.revision, url, connectionId, repositoryId },
        controller.signal,
      );
      if (current === epoch.current && result.revision === saved.revision) {
        setResults((value) => ({ ...value, [kind]: result }));
        void proxyApi
          .connections()
          .then(setServers)
          .catch(() => {});
      }
    } catch (error) {
      if (current === epoch.current && !controller.signal.aborted)
        setResults((value) => ({
          ...value,
          [kind]: {
            revision: saved.revision,
            success: false,
            elapsedMs: 0,
            message: proxyError(error),
          },
        }));
    } finally {
      if (current === epoch.current) setTesting((value) => ({ ...value, [kind]: false }));
    }
  };
  const reconnect = async (id: string) => {
    if (!saved) return;
    setReconnecting(id);
    invalidate();
    setNotice(undefined);
    try {
      setServers(await proxyApi.reconnect(id, saved.revision));
    } catch (error) {
      setNotice({ error: true, text: proxyError(error) });
    } finally {
      setReconnecting(undefined);
    }
  };
  const result = (kind: TestKind) =>
    results[kind] && (
      <div
        role="status"
        className={`proxy-test-result ${results[kind]!.success ? 'is-success' : 'is-error'}`}
      >
        {results[kind]!.message}{' '}
        {results[kind]!.elapsedMs > 0 && <span>· {results[kind]!.elapsedMs} ms</span>}
      </div>
    );
  const testsDisabled = busy || dirty || outdated || !saved?.enabled;
  const server = servers.find((item) => item.id === connectionId);
  return (
    <div className="settings-page-content proxy-settings">
      <div className="settings-section-heading">
        <h1>网络代理</h1>
        {saved && (
          <Tag color={saved.enabled ? 'blue' : undefined}>
            {saved.enabled ? '已启用' : '已关闭'}
          </Tag>
        )}
      </div>
      <p className="settings-lead">统一配置 AI、应用更新、SSH 与远端 Git 的网络代理。</p>
      {notice && blocker.state !== 'blocked' && (
        <FeedbackNotice
          source="proxy-result"
          type={notice.error ? 'error' : 'success'}
          title={notice.error ? '代理配置操作未完成' : notice.text}
          description={
            notice.error ? `${notice.text}\n重新加载会丢弃当前草稿并读取最新配置。` : notice.text
          }
          eventKey={notice}
          actionLabel={notice.error ? '重新加载（丢弃草稿）' : undefined}
          onAction={load}
          busy={busy}
        />
      )}
      <FeedbackNotice
        source="proxy-outdated"
        title={outdated ? '其他窗口已修改代理配置' : null}
        type="warning"
        mode="notification"
        description="当前草稿仍保留。重新加载会丢弃草稿并读取最新配置。"
        actionLabel="重新加载（丢弃草稿）"
        onAction={load}
        busy={busy}
      />
      {!saved || !draft ? (
        <div role="status">
          {busy ? '正在读取代理配置…' : <Button onClick={() => void load()}>重新加载</Button>}
        </div>
      ) : (
        <>
          <div className="proxy-columns">
            <div className="proxy-primary">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={busy} className="settings-fieldset proxy-panel">
                  <div className="settings-section-heading">
                    <h2>
                      <GlobalOutlined /> 代理配置
                    </h2>
                    <Switch
                      aria-label="启用网络代理"
                      checked={draft.enabled}
                      onChange={(enabled) => change({ enabled })}
                    />
                  </div>
                  <p className="settings-field-hint">
                    关闭代理保留已填写的内容和认证信息，保存后生效。
                  </p>
                  <label className="settings-field">
                    代理类型
                    <select
                      aria-label="代理类型"
                      value={draft.protocol}
                      onChange={(event) =>
                        change({ protocol: event.target.value as SaveNetworkProxy['protocol'] })
                      }
                    >
                      <option value="http">HTTP</option>
                      <option value="https">HTTPS</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                  </label>
                  <div className="settings-form-row proxy-address">
                    <label className="settings-field">
                      服务器地址
                      <Input
                        aria-label="代理服务器地址"
                        placeholder="例如 127.0.0.1"
                        value={draft.host}
                        onChange={(event) => change({ host: event.target.value })}
                        autoComplete="off"
                      />
                    </label>
                    <label className="settings-field">
                      端口
                      <Input
                        aria-label="代理端口"
                        type="number"
                        min={1}
                        max={65535}
                        step={1}
                        value={draft.port || ''}
                        onChange={(event) => change({ port: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <p className="settings-field-hint">
                    地址不包含协议或端口。HTTPS 代理会验证 TLS 证书；SOCKS5 由代理解析目标域名。
                  </p>
                  <div className="settings-section-heading proxy-auth-heading">
                    <h2>代理认证</h2>
                    <Switch
                      aria-label="启用代理认证"
                      checked={draft.authEnabled}
                      onChange={(authEnabled) => change({ authEnabled })}
                    />
                  </div>
                  {saved.hasCredentials && draft.credentials.action === 'keep' && (
                    <div className="proxy-credential-state">
                      <span>认证信息已保存 · 不显示原值</span>
                      <Button
                        size="small"
                        onClick={() =>
                          change({ credentials: { action: 'replace', username: '', password: '' } })
                        }
                      >
                        替换认证
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          change({ authEnabled: false, credentials: { action: 'clear' } })
                        }
                      >
                        清除认证
                      </Button>
                    </div>
                  )}
                  {draft.credentials.action === 'clear' && (
                    <p role="status">认证信息将在保存后清除。</p>
                  )}
                  {draft.authEnabled &&
                    (draft.credentials.action === 'replace' || !saved.hasCredentials) && (
                      <div className="settings-form-row">
                        <label className="settings-field">
                          用户名
                          <Input
                            aria-label="代理用户名"
                            value={
                              draft.credentials.action === 'replace'
                                ? draft.credentials.username
                                : ''
                            }
                            autoComplete="off"
                            onChange={(event) =>
                              change({
                                credentials: {
                                  action: 'replace',
                                  username: event.target.value,
                                  password:
                                    draft.credentials.action === 'replace'
                                      ? draft.credentials.password
                                      : '',
                                },
                              })
                            }
                          />
                        </label>
                        <label className="settings-field">
                          新密码
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            suffix={
                              <button
                                type="button"
                                className="settings-secret-toggle"
                                aria-label={showPassword ? '隐藏代理新密码' : '显示代理新密码'}
                                aria-pressed={showPassword}
                                onClick={() => setShowPassword(!showPassword)}
                              >
                                {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                              </button>
                            }
                            aria-label="代理新密码"
                            value={
                              draft.credentials.action === 'replace'
                                ? draft.credentials.password
                                : ''
                            }
                            autoComplete="new-password"
                            onChange={(event) =>
                              change({
                                credentials: {
                                  action: 'replace',
                                  password: event.target.value,
                                  username:
                                    draft.credentials.action === 'replace'
                                      ? draft.credentials.username
                                      : '',
                                },
                              })
                            }
                          />
                        </label>
                      </div>
                    )}
                  <p className="settings-field-hint">
                    用户名和密码加密保存在此设备。保留认证时无需重新输入；改变代理地址后需重新填写。
                  </p>
                  {!saved.secretStorageAvailable && (
                    <Alert type="warning" title="设备安全存储不可用，暂时无法保存新的认证信息。" />
                  )}
                </fieldset>
              </form>
              <section className="proxy-panel" aria-label="代理连接测试">
                <h2>
                  <ApiOutlined /> 连接测试
                </h2>
                <p className="settings-field-hint">
                  分别验证各条链路，测试只使用已保存且已启用的配置。Git 测试仅读取远程引用。
                </p>
                {dirty && <p className="proxy-test-result">有未保存修改，请先保存配置后测试。</p>}
                <label className="settings-field">
                  HTTP 测试地址
                  <Input
                    aria-label="HTTP 测试地址"
                    value={url}
                    onChange={(event) => {
                      invalidate();
                      setUrl(event.target.value);
                    }}
                  />
                </label>
                <Button
                  disabled={testsDisabled || !url}
                  loading={testing.http}
                  onClick={() => void test('http')}
                >
                  {results.http?.success === false ? '重试 HTTP' : '测试 HTTP'}
                </Button>
                {result('http')}
                <label className="settings-field proxy-test-target">
                  SSH 服务器
                  <select
                    aria-label="测试 SSH 服务器"
                    value={connectionId}
                    onChange={(event) => {
                      invalidate();
                      setConnectionId(event.target.value);
                      setRepositoryId('');
                    }}
                  >
                    <option value="">选择服务器</option>
                    {servers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={testsDisabled || !connectionId}
                  loading={testing.ssh}
                  onClick={() => void test('ssh')}
                >
                  {results.ssh?.success === false ? '重试 SSH' : '测试 SSH'}
                </Button>
                {result('ssh')}
                <label className="settings-field proxy-test-target">
                  远端 Git 仓库
                  <select
                    aria-label="测试远端 Git 仓库"
                    value={repositoryId}
                    onChange={(event) => {
                      invalidate();
                      setRepositoryId(event.target.value);
                    }}
                  >
                    <option value="">选择已打开的仓库或 Worktree</option>
                    {repositories
                      .filter((repo) => repo.connectionId === connectionId)
                      .map((repo) => (
                        <option key={repo.id} value={repo.id}>
                          {repo.name} · {repo.path}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  disabled={testsDisabled || !repositoryId || server?.pendingReconnect}
                  loading={testing.git}
                  onClick={() => void test('git')}
                >
                  {results.git?.success === false ? '重试远端 Git' : '测试远端 Git'}
                </Button>
                {result('git')}
                {server?.pendingReconnect && (
                  <p className="settings-field-hint">
                    此服务器需先重新连接，才能测试当前配置的远端 Git。
                  </p>
                )}
              </section>
            </div>
            <aside className="proxy-secondary">
              <section className="proxy-panel">
                <h2>配置如何生效</h2>
                <p>本机新请求在保存后使用新配置；代理失败会明确报错。</p>
                <p>
                  已有 SSH
                  连接继续使用原配置，断线自动重连也沿用原配置。点击“重新连接并应用”后切换。
                </p>
                <p>
                  远端 Git 通过 SSH
                  回环转发复用本机代理，认证信息留在本机。服务器需要允许转发，并提供 Python 3 和
                  OpenSSH。
                </p>
                <p className="settings-field-hint">
                  独立服务部署时，“本机”指运行 Alune 服务的主机。浏览器所在电脑的 127.0.0.1
                  代理不一定可达。应用内部通信保持直连。
                </p>
              </section>
              <section className="proxy-panel" aria-label="服务器代理状态">
                <FeedbackNotice
                  source="proxy-server-status"
                  title={statusError ? '暂时无法刷新服务器状态' : null}
                  type="warning"
                  mode="notification"
                  description="显示的是上次结果。后台会继续刷新，当前代理草稿仍保留。"
                />
                <h2>
                  <CloudServerOutlined /> 远端 Git 状态
                </h2>
                <p className="settings-field-hint">SSH 已连接不代表 Git 转发可用。</p>
                {!servers.length && (
                  <div>
                    <p>尚未添加 SSH 服务器。</p>
                    <Button onClick={() => navigate('/connections')}>添加连接</Button>
                  </div>
                )}
                {servers.map((item) => (
                  <div className="proxy-server" key={item.id}>
                    <strong>{item.name}</strong>
                    <span>
                      SSH：{item.connecting ? '连接中' : item.connected ? '已连接' : '未连接'}
                    </span>
                    <Tag
                      color={
                        item.pendingReconnect
                          ? 'orange'
                          : item.forwarding === 'ready'
                            ? 'green'
                            : undefined
                      }
                    >
                      {item.pendingReconnect ? '重新连接后生效' : forwardingLabels[item.forwarding]}
                    </Tag>
                    {item.error && <p className="proxy-test-result is-error">{item.error}</p>}
                    {item.activeTasks > 0 && <span>运行中任务：{item.activeTasks}</span>}
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={reconnecting === item.id}
                      disabled={
                        busy ||
                        dirty ||
                        outdated ||
                        statusError ||
                        Boolean(reconnecting) ||
                        item.activeTasks > 0 ||
                        item.connecting
                      }
                      onClick={() => void reconnect(item.id)}
                    >
                      {item.pendingReconnect
                        ? '重新连接并应用'
                        : item.connected
                          ? '重新连接'
                          : '连接服务器'}
                    </Button>
                  </div>
                ))}
              </section>
            </aside>
          </div>
          <div className="proxy-savebar">
            <span>
              {dirty ? '有未保存修改' : '配置已保存'}
              {saved.enabled ? ' · 已启用' : ' · 已关闭'}
            </span>
            <div>
              <Button
                disabled={!dirty || busy}
                onClick={() => {
                  accept(saved);
                  setNotice(undefined);
                }}
              >
                放弃修改
              </Button>
              <Button
                type="primary"
                disabled={!dirty || outdated}
                loading={busy}
                onClick={() => void save()}
              >
                保存配置
              </Button>
            </div>
          </div>
        </>
      )}
      <Modal
        open={blocker.state === 'blocked'}
        title="保存网络代理修改？"
        onCancel={() => blocker.state === 'blocked' && !busy && blocker.reset()}
        closable={!busy}
        keyboard={!busy}
        maskClosable={!busy}
        footer={
          <>
            <Button disabled={busy} onClick={() => blocker.state === 'blocked' && blocker.reset()}>
              继续编辑
            </Button>
            <Button
              disabled={busy}
              onClick={() => blocker.state === 'blocked' && blocker.proceed()}
            >
              放弃修改并离开
            </Button>
            <Button
              type="primary"
              loading={busy}
              disabled={outdated}
              onClick={() => {
                void save().then((success) => {
                  if (success && blocker.state === 'blocked') blocker.proceed();
                });
              }}
            >
              保存并离开
            </Button>
          </>
        }
      >
        <p>离开前保存配置，或放弃这次修改。已有 SSH 工作不会被保存操作中断。</p>
        {notice?.error && <Alert type="error" title={notice.text} />}
      </Modal>
    </div>
  );
}

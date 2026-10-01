import { FeedbackAlert } from '../FeedbackAlert';
import { FeedbackNotice } from '../Feedback';
import { useEffect, useState } from 'react';
import { Button, Empty, Input, Spin } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AccessToken } from '@alune/shared';
import { accessTokenApi } from '../../api';
import { useAccessTokensStore } from '../../stores/accessTokensStore';
import type { TokenReturnTarget } from '../../stores/accessTokensStore';
import { errorMessage } from '../files-tree';
import { AluneModal, DialogHints, Kbd } from '../AluneModal';
import { DialogCard, DialogEmpty, DialogNote } from '../DialogParts';
import { DialogIcon } from '../DialogIcons';

/** Host plus repository path, with the path emphasised; unparsable targets stay verbatim. */
function AssociationTarget({ target }: { target: string }) {
  let host = '';
  let path = '';
  try {
    const url = new URL(target);
    host = url.host;
    path = url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    // Not a URL (for example an scp-style remote); show it as given.
  }
  return (
    <span className="dlg-path" title={target}>
      {host && path ? (
        <>
          {host}/<b>{path}</b>
        </>
      ) : (
        target
      )}
    </span>
  );
}

/** Shared by the delete confirmation and the associations dialog so both show the same list. */
function TokenAssociations({ token }: { token: AccessToken }) {
  return (
    <DialogCard>
      <ul className="dlg-list is-scroll" aria-label={`“${token.name}”关联的仓库远端`}>
        {token.associations.map((a) => (
          <li className="dlg-list-item" key={`${a.repositoryId}:${a.remote}`}>
            <DialogIcon name="link" />
            <div className="dlg-list-main">
              <strong>
                {a.repositoryName} · {a.remote}
              </strong>
              <AssociationTarget target={a.target} />
            </div>
          </li>
        ))}
      </ul>
    </DialogCard>
  );
}

export function AccessTokenSettings({ returnTo }: { returnTo: string }) {
  const { settings, error, loading, load, accept, choose } = useAccessTokensStore();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTarget = location.state?.tokenReturn as TokenReturnTarget | undefined;
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ token: AccessToken | null; revision: string } | null>(
    null,
  );
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [replaceValue, setReplaceValue] = useState(false);
  const [deletion, setDeletion] = useState<{ token: AccessToken; revision: string } | null>(null);
  const [usage, setUsage] = useState<AccessToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void load();
  }, [load]);

  const edit = (token: AccessToken | null) => {
    if (!settings) return;
    setName(token?.name || '');
    setValue('');
    setShowValue(false);
    setReplaceValue(!token);
    setNotice('');
    setEditor({ token, revision: settings.revision });
  };
  const closeEditor = () => {
    if (!busy) {
      setEditor(null);
      setValue('');
      setNotice('');
    }
  };
  const save = async () => {
    if (!editor || busy) return;
    if (!name.trim()) {
      setNotice('请输入令牌名称。');
      return;
    }
    if (replaceValue && !value) {
      setNotice('请输入令牌值。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await accessTokenApi.save(editor.token?.id || null, {
        name: name.trim(),
        ...(replaceValue ? { value } : {}),
        revision: editor.revision,
      });
      accept(result);
      setValue('');
      setEditor(null);
      if (!editor.token && returnTarget) {
        const created = result.tokens.find((token) => token.name === name.trim());
        if (created) choose({ ...returnTarget, tokenId: created.id });
        navigate(returnTo);
      }
    } catch (failure) {
      setNotice(errorMessage(failure, '保存失败，请重试。'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deletion || busy) return;
    setBusy(true);
    setNotice('');
    try {
      accept(await accessTokenApi.delete(deletion.token.id, deletion.revision));
      setDeletion(null);
    } catch (failure) {
      setNotice(errorMessage(failure, '删除失败，请重试。'));
    } finally {
      setBusy(false);
    }
  };
  const tokens =
    settings?.tokens.filter((token) =>
      token.name.toLowerCase().includes(query.trim().toLowerCase()),
    ) || [];
  const reloadModal = async () => {
    await load();
    const latest = useAccessTokensStore.getState().settings;
    if (useAccessTokensStore.getState().error || !latest) return;
    setValue('');
    setNotice('已重新加载，请检查后再次确认。');
    if (deletion) {
      const token = latest.tokens.find((t) => t.id === deletion.token.id);
      setDeletion(token ? { token, revision: latest.revision } : null);
    }
    if (editor) {
      const token = editor.token ? latest.tokens.find((t) => t.id === editor.token!.id) : null;
      if (editor.token && !token) {
        setEditor(null);
        return;
      }
      setEditor({ token: token || null, revision: latest.revision });
      setName(token?.name || name);
      setReplaceValue(!token);
    }
  };

  return (
    <div className="settings-page-content settings-page-content--wide access-token-settings">
      <div className="token-page-heading">
        <div>
          <h1>访问令牌</h1>
          <p className="settings-lead">
            给令牌起个名字，在仓库的 PR/MR 页面按名称选择。令牌仅用于明确关联的仓库远端。
          </p>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!settings || !settings.secretStorage.available}
          onClick={() => edit(null)}
        >
          新增令牌
        </Button>
      </div>
      <FeedbackNotice
        source="access-tokens"
        title={error ? '访问令牌加载失败' : null}
        description={error}
        actionLabel="重新加载"
        busy={loading}
        onAction={load}
      />
      {!settings && error && !loading && (
        <div role="status">
          无法读取访问令牌。<Button onClick={() => void load()}>重新加载</Button>
        </div>
      )}
      {settings && !settings.secretStorage.available && (
        <FeedbackAlert
          source="AccessTokenSettings-1"
          type="warning"
          title="加密存储不可用"
          description={settings.secretStorage.description}
        />
      )}
      {loading && !settings ? (
        <Spin aria-label="正在读取访问令牌" />
      ) : settings && !settings.tokens.length ? (
        <Empty description="还没有保存令牌">
          <Button
            type="primary"
            disabled={!settings.secretStorage.available}
            onClick={() => edit(null)}
          >
            添加第一个令牌
          </Button>
        </Empty>
      ) : (
        settings && (
          <>
            <Input
              className="token-search"
              aria-label="搜索令牌"
              placeholder="搜索令牌名称…"
              prefix={<SearchOutlined />}
              value={query}
              allowClear
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="token-list" aria-label="已保存的访问令牌">
              {tokens.map((token) => (
                <li key={token.id}>
                  <div className="token-identity">
                    <strong>{token.name}</strong>
                    <span>
                      {token.scope
                        ? `${token.scope.provider === 'github' ? 'GitHub' : 'GitLab'} · ${token.scope.origin}`
                        : '首次使用时关联主机'}
                    </span>
                  </div>
                  <div className="token-mask">
                    <span aria-label="已保存的令牌值">••••••••</span>
                    <small>更新于 {new Date(token.updatedAt).toLocaleDateString('zh-CN')}</small>
                  </div>
                  <Button type="text" onClick={() => setUsage(token)}>
                    {token.associations.length
                      ? `${new Set(token.associations.map((a) => a.repositoryId)).size} 个仓库关联`
                      : '尚未使用'}
                  </Button>
                  <div className="token-actions">
                    <Button
                      type="text"
                      icon={<EditOutlined />}
                      aria-label={`编辑令牌 ${token.name}`}
                      onClick={() => edit(token)}
                    >
                      编辑
                    </Button>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={`删除令牌 ${token.name}`}
                      onClick={() => {
                        setNotice('');
                        setDeletion({ token, revision: settings.revision });
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {!tokens.length && (
              <Empty description="没有匹配的令牌" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </>
        )
      )}
      <p className="settings-field-hint">
        令牌加密保存在此设备。每个仓库需要明确选择，不会自动用于其他仓库。
      </p>
      <AluneModal
        size="md"
        glyph="key"
        eyebrow={{ label: '设置', detail: '访问令牌' }}
        title={editor?.token ? '编辑令牌' : '新增令牌'}
        description="这里只保存配置；实际访问权限会在仓库读取 PR/MR 时检查。"
        open={!!editor}
        onCancel={closeEditor}
        onOk={save}
        confirmLoading={busy}
        okDisabled={!name.trim() || (replaceValue && !value)}
        okText={!editor?.token && returnTarget ? '保存并返回仓库' : '保存令牌'}
        busyText="正在保存…"
        hintVerb="保存"
        destroyOnHidden
      >
        <label className="dlg-fld">
          <span className="dlg-fld-label">
            <span>令牌名称</span>
            <small>最多 50 字</small>
          </span>
          <Input
            data-autofocus
            aria-label="令牌名称"
            maxLength={50}
            autoComplete="off"
            disabled={busy}
            prefix={<DialogIcon name="pencil" />}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：公司 GitLab"
          />
        </label>
        {replaceValue ? (
          <label className="dlg-fld">
            <span className="dlg-fld-label">
              <span>令牌值</span>
            </span>
            <Input
              className="dlg-mono-input"
              aria-label="令牌值"
              type={showValue ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              // Unlocking an existing token's value moves focus straight to the new field.
              autoFocus={!!editor?.token}
              maxLength={4096}
              disabled={busy}
              prefix={<DialogIcon name="key" />}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="输入或粘贴访问令牌"
              suffix={
                <button
                  type="button"
                  className="dlg-icon-btn"
                  aria-label={showValue ? '隐藏令牌值' : '显示令牌值'}
                  aria-pressed={showValue}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowValue(!showValue);
                  }}
                >
                  <DialogIcon name={showValue ? 'eye-off' : 'eye'} />
                </button>
              }
            />
            {editor?.token && (
              <span className="dlg-fld-hint">
                保存后，{editor.token.associations.length} 个仓库远端关联的新请求会使用新值。
              </span>
            )}
          </label>
        ) : (
          <div className="dlg-fld">
            <span className="dlg-fld-label">
              <span>令牌值</span>
              <small>已保存</small>
            </span>
            <Input
              className="dlg-mono-input"
              aria-label="已保存的令牌值"
              disabled
              value="••••••••••••••••"
              prefix={<DialogIcon name="lock" />}
              suffix={
                <Button
                  size="small"
                  type="text"
                  className="dlg-inp-btn"
                  disabled={busy || !settings?.secretStorage.available}
                  onClick={() => setReplaceValue(true)}
                >
                  更换令牌值
                </Button>
              }
            />
            {editor?.token && (
              <span className="dlg-fld-hint">
                更换后，{editor.token.associations.length} 个仓库远端关联的新请求会使用新值。
              </span>
            )}
          </div>
        )}
        {notice && (
          <DialogNote
            tone="warning"
            role="alert"
            title={notice}
            action={
              <Button size="small" disabled={busy} onClick={() => void reloadModal()}>
                重新加载
              </Button>
            }
          />
        )}
      </AluneModal>
      <AluneModal
        level={1}
        danger
        tone="warning"
        size="md"
        glyph="key"
        eyebrow={{ label: '设置', detail: '访问令牌' }}
        title={`删除令牌“${deletion?.token.name || ''}”？`}
        description="只删除 Alune 保存的配置，不会在 GitHub / GitLab 撤销令牌。"
        open={!!deletion}
        onCancel={() => {
          if (!busy) {
            setDeletion(null);
            setNotice('');
          }
        }}
        onOk={remove}
        confirmLoading={busy}
        okText={deletion?.token.associations.length ? '删除令牌及关联' : '删除令牌'}
        busyText="正在删除…"
        hintVerb="删除"
        destroyOnHidden
      >
        {deletion && deletion.token.associations.length ? (
          <>
            <p className="dlg-sub">
              <span>以下仓库远端将解除关联</span>
              <small>{deletion.token.associations.length}</small>
            </p>
            <TokenAssociations token={deletion.token} />
            <p className="dlg-text is-muted">删除后，这些远端需要重新选择令牌才能读取 PR/MR。</p>
          </>
        ) : (
          <DialogNote quiet>尚未关联仓库，删除不会影响任何远端。</DialogNote>
        )}
        {notice && (
          <DialogNote
            tone="warning"
            role="alert"
            title={notice}
            action={
              <Button size="small" disabled={busy} onClick={() => void reloadModal()}>
                重新加载影响范围
              </Button>
            }
          />
        )}
      </AluneModal>
      <AluneModal
        size="md"
        glyph="link"
        eyebrow={{
          label: '设置',
          detail: usage?.scope
            ? `访问令牌 · ${usage.scope.provider === 'github' ? 'GitHub' : 'GitLab'}`
            : '访问令牌',
        }}
        title={`“${usage?.name || ''}”的仓库关联`}
        description={
          usage?.associations.length ? '以下仓库远端使用此令牌读取和操作 PR/MR。' : undefined
        }
        open={!!usage}
        onCancel={() => setUsage(null)}
        hints={
          <DialogHints>
            <span>
              <Kbd>Esc</Kbd> 关闭
            </span>
          </DialogHints>
        }
        footer={
          <Button autoFocus onClick={() => setUsage(null)}>
            关闭
          </Button>
        }
      >
        {usage &&
          (usage.associations.length ? (
            <TokenAssociations token={usage} />
          ) : (
            <DialogCard>
              <DialogEmpty>尚未关联仓库。</DialogEmpty>
            </DialogCard>
          ))}
      </AluneModal>
    </div>
  );
}

import { FeedbackNotice } from '../Feedback';
import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Spin } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AccessToken } from '@alune/shared';
import { accessTokenApi } from '../../api';
import { useAccessTokensStore } from '../../stores/accessTokensStore';
import type { TokenReturnTarget } from '../../stores/accessTokensStore';
import { errorMessage } from '../files-tree';

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
  const associations = (token: AccessToken) =>
    token.associations.length ? (
      <ul className="token-associations">
        {token.associations.map((a) => (
          <li key={`${a.repositoryId}:${a.remote}`}>
            <strong>
              {a.repositoryName} · {a.remote}
            </strong>
            <span>{a.target}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="settings-muted">尚未关联仓库。</p>
    );
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
    <div className="settings-page-content access-token-settings">
      <div className="token-page-heading">
        <div>
          <h1>访问令牌</h1>
          <p className="settings-lead">给令牌起个名字，在仓库的 PR/MR 页面按名称选择。</p>
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
        <Alert
          type="warning"
          showIcon
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
      <Modal
        title={editor?.token ? '编辑令牌' : '新增令牌'}
        open={!!editor}
        onCancel={closeEditor}
        onOk={() => void save()}
        confirmLoading={busy}
        cancelButtonProps={{ disabled: busy }}
        okText={!editor?.token && returnTarget ? '保存并返回仓库' : '保存令牌'}
        cancelText="取消"
        destroyOnHidden
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset className="settings-fieldset" disabled={busy}>
            <label className="settings-field">
              令牌名称
              <Input
                autoFocus
                aria-label="令牌名称"
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：公司 GitLab"
              />
            </label>
            {replaceValue ? (
              <label className="settings-field">
                令牌值
                <Input
                  aria-label="令牌值"
                  type={showValue ? 'text' : 'password'}
                  autoComplete="off"
                  maxLength={4096}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="输入或粘贴访问令牌"
                  suffix={
                    <button
                      type="button"
                      className="settings-secret-toggle"
                      aria-label={showValue ? '隐藏令牌值' : '显示令牌值'}
                      aria-pressed={showValue}
                      onClick={(event) => {
                        event.stopPropagation();
                        setShowValue(!showValue);
                      }}
                    >
                      {showValue ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                    </button>
                  }
                />
              </label>
            ) : (
              <div className="token-saved-value">
                <span>令牌值 · 已保存</span>
                <Button
                  disabled={!settings?.secretStorage.available}
                  onClick={() => setReplaceValue(true)}
                >
                  更换令牌值
                </Button>
              </div>
            )}
            {editor?.token && replaceValue && (
              <p className="settings-field-hint">
                保存后，{editor.token.associations.length} 个仓库远端关联的新请求将使用新值。
              </p>
            )}
            <p className="settings-field-hint">
              保存仅保存配置，实际访问权限会在仓库读取 PR/MR 时检查。
            </p>
            <button type="submit" hidden />
          </fieldset>
        </form>
        {notice && (
          <Alert
            role="alert"
            type="warning"
            title={notice}
            action={
              <Button disabled={busy} onClick={() => void reloadModal()}>
                重新加载
              </Button>
            }
          />
        )}
      </Modal>
      <Modal
        title={`删除令牌“${deletion?.token.name || ''}”`}
        open={!!deletion}
        onCancel={() => {
          if (!busy) {
            setDeletion(null);
            setNotice('');
          }
        }}
        onOk={() => void remove()}
        confirmLoading={busy}
        cancelButtonProps={{ disabled: busy }}
        okText="删除令牌及关联"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        destroyOnHidden
      >
        <p>以下仓库远端将解除关联，需要重新选择令牌：</p>
        {deletion && associations(deletion.token)}
        <p className="settings-field-hint">
          仅删除 Alune 保存的配置，不会在 GitHub / GitLab 撤销令牌。
        </p>
        {notice && (
          <Alert
            role="alert"
            type="warning"
            title={notice}
            action={
              <Button disabled={busy} onClick={() => void reloadModal()}>
                重新加载影响范围
              </Button>
            }
          />
        )}
      </Modal>
      <Modal
        title={`“${usage?.name || ''}”的仓库关联`}
        open={!!usage}
        onCancel={() => setUsage(null)}
        footer={<Button onClick={() => setUsage(null)}>关闭</Button>}
      >
        {usage && associations(usage)}
      </Modal>
    </div>
  );
}

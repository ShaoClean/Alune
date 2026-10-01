import { FeedbackAlert } from '@alune/ui';
import { FeedbackNotice } from '@alune/ui';
import { useEffect, useRef, useState } from 'react';
import { Button, Input, Switch, Tag, Select } from '@alune/ui';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { AiModel, AiProvider, AiSettings, SaveAiProvider } from '@alune/shared';
import { aiApi, aiError } from '../../api/ai';
import { useAiSettingsStore } from '../../stores/aiSettingsStore';
import { AluneModal } from '@alune/ui';
import { DialogNote } from '@alune/ui';
import { DialogIcon } from '@alune/ui';

const initialProvider = (): SaveAiProvider => ({
  name: '',
  protocol: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  models: [],
});
const editable = (p: AiProvider): SaveAiProvider => ({
  name: p.name,
  protocol: p.protocol,
  baseUrl: p.baseUrl,
  enabled: p.enabled,
  models: p.models,
});
const protocolNames = { openai: 'OpenAI 兼容', anthropic: 'Anthropic', gemini: 'Gemini' };

const initialTestModel = (provider: AiProvider | undefined, settings: AiSettings): string => {
  const preferred =
    settings.commit.providerId === provider?.id ? settings.commit.modelId : undefined;
  return (
    provider?.models.find((model) => model.id === preferred)?.id ||
    provider?.models.find((model) => model.enabled)?.id ||
    provider?.models[0]?.id ||
    ''
  );
};

export function ProviderSettings({ settings }: { settings: AiSettings }) {
  const [selected, setSelected] = useState(
    settings.commit.providerId || settings.providers[0]?.id || 'new',
  );
  const [query, setQuery] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  const provider = settings.providers.find((p) => p.id === selected);
  const select = (id: string) => {
    setSelected(id);
    setMobileDetail(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.provider-detail h1')?.focus(),
    );
  };
  return (
    <div className={`provider-settings${mobileDetail ? ' provider-settings--detail' : ''}`}>
      <section ref={listRef} className="provider-list" aria-label="AI 服务商列表">
        <div className="settings-section-heading">
          <strong>服务商</strong>
          <span className="count-badge">{settings.providers.length}</span>
        </div>
        <Input
          aria-label="搜索服务商"
          placeholder="搜索服务商…"
          prefix={<SearchOutlined />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          allowClear
        />
        <div className="provider-list__items">
          {settings.providers
            .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
            .map((p) => (
              <button
                type="button"
                key={p.id}
                className="provider-list__item"
                aria-current={selected === p.id ? 'true' : undefined}
                onClick={() => select(p.id)}
              >
                <span className="provider-avatar">{p.name.slice(0, 1)}</span>
                <span className="provider-list__copy">
                  <strong>{p.name}</strong>
                  <small>{p.enabled ? '已启用' : p.builtin ? '预置服务商' : '自定义服务商'}</small>
                </span>
                {p.enabled && <span className="provider-enabled-dot" aria-label="已启用" />}
              </button>
            ))}
          {!settings.providers.some((p) =>
            p.name.toLowerCase().includes(query.trim().toLowerCase()),
          ) && <p className="settings-muted">没有匹配的服务商</p>}
        </div>
        <div className="provider-list__add">
          <Button block icon={<PlusOutlined />} onClick={() => select('new')}>
            自定义服务商
          </Button>
          <p className="settings-field-hint">设置应用于此设备的所有仓库</p>
        </div>
      </section>
      <div className="provider-detail">
        <Button
          className="provider-mobile-back"
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => {
            setMobileDetail(false);
            requestAnimationFrame(() =>
              listRef.current?.querySelector<HTMLElement>('button[aria-current="true"]')?.focus(),
            );
          }}
        >
          返回服务商列表
        </Button>
        <ProviderForm key={selected} provider={provider} settings={settings} onCreated={select} />
      </div>
    </div>
  );
}

function ProviderForm({
  provider,
  settings,
  onCreated,
}: {
  provider?: AiProvider;
  settings: AiSettings;
  onCreated: (id: string) => void;
}) {
  const [draft, setDraft] = useState<SaveAiProvider>(() =>
    provider ? editable(provider) : initialProvider(),
  );
  const [key, setKey] = useState<string | null | undefined>();
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [modelEditor, setModelEditor] = useState<{
    originalId: string | null;
    id: string;
    name: string;
  } | null>(null);
  const [modelToDelete, setModelToDelete] = useState<AiModel | null>(null);
  const [modelError, setModelError] = useState<{ field: 'id' | 'name'; message: string } | null>(
    null,
  );
  const [testModelId, setTestModelId] = useState(() => initialTestModel(provider, settings));
  const active = useRef<AbortController | null>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const accept = useAiSettingsStore((state) => state.accept);
  const dirty =
    !provider || key !== undefined || JSON.stringify(draft) !== JSON.stringify(editable(provider));
  const isDefaultModel = (id: string) =>
    settings.commit.providerId === provider?.id && settings.commit.modelId === id;
  const defaultModelCleared =
    settings.commit.providerId === provider?.id &&
    (!draft.enabled || !draft.models.some((model) => isDefaultModel(model.id) && model.enabled));
  useEffect(() => {
    setModelEditor(null);
    setModelToDelete(null);
    setModelError(null);
    if (provider) {
      setDraft(editable(provider));
      setKey(undefined);
      setShowKey(false);
      setTestModelId((current) =>
        current === '' || provider.models.some((model) => model.id === current)
          ? current
          : initialTestModel(provider, settings),
      );
    }
  }, [provider?.id, settings.revision]);
  useEffect(() => {
    return () => active.current?.abort();
  }, []);

  const save = async () => {
    setBusy('save');
    setNotice(null);
    try {
      const result = await aiApi.saveProvider(
        provider?.id,
        { ...draft, apiKey: key },
        settings.revision,
      );
      accept(result);
      if (!provider) {
        const created = result.providers.find(
          (p) => !settings.providers.some((old) => old.id === p.id),
        );
        if (created) onCreated(created.id);
      }
      setNotice({ error: false, message: '配置已保存。' });
    } catch (error) {
      setNotice({ error: true, message: aiError(error) });
    } finally {
      setBusy(null);
    }
  };

  const run = async (operation: 'test' | 'models') => {
    if (!provider) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(operation);
    setNotice(null);
    try {
      if (operation === 'models') {
        const result = await aiApi.models(provider.id, settings.revision, controller.signal);
        if (controller.signal.aborted) return;
        accept(result);
        setNotice({
          error: false,
          message: '模型列表已更新。新发现的模型默认停用，手动配置及已有启用状态已保留。',
        });
      } else {
        const result = await aiApi.test(
          provider.id,
          { revision: settings.revision, modelId: testModelId || null },
          controller.signal,
        );
        if (!controller.signal.aborted) setNotice({ error: false, message: result.message });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice({
          error: true,
          message: `${aiError(error)}${operation === 'models' ? ' 原有列表已保留，可手动添加。' : ''}`,
        });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(null);
      }
    }
  };

  const openModelEditor = (model?: AiModel) => {
    setModelEditor({
      originalId: model?.id ?? null,
      id: model?.id ?? '',
      name: model?.name ?? '',
    });
    setModelError(null);
  };

  const applyModel = () => {
    if (!modelEditor || busy) return;
    const id = modelEditor.id.trim();
    if (!id || id.length > 200 || /[\s\0]/.test(id)) {
      setModelError({ field: 'id', message: '请输入准确的模型 ID，不含空格。' });
      return;
    }
    if (draft.models.some((m) => m.id === id && m.id !== modelEditor.originalId)) {
      setModelError({ field: 'id', message: '此模型 ID 已存在。' });
      return;
    }
    const name = modelEditor.name.trim() || id;
    if (name.length > 200 || name.includes('\0')) {
      setModelError({ field: 'name', message: '模型名称无效（最多 200 个字符）。' });
      return;
    }
    setDraft((current) => ({
      ...current,
      models:
        modelEditor.originalId === null
          ? [...current.models, { id, name, enabled: true }]
          : current.models.map((model) =>
              model.id === modelEditor.originalId ? { ...model, id, name } : model,
            ),
    }));
    setModelEditor(null);
    setModelError(null);
    setNotice(null);
  };

  const modelIdTaken =
    !!modelEditor &&
    draft.models.some((m) => m.id === modelEditor.id.trim() && m.id !== modelEditor.originalId);
  const modelIdError = modelIdTaken
    ? '此模型 ID 已存在。'
    : modelError?.field === 'id'
      ? modelError.message
      : '';

  const deleteModel = () => {
    if (!modelToDelete || busy) return;
    setDraft((current) => ({
      ...current,
      models: current.models.filter((model) => model.id !== modelToDelete.id),
    }));
    setModelToDelete(null);
    setNotice(null);
  };

  return (
    <>
      <div className="provider-detail__heading">
        <span className="provider-avatar provider-avatar--large">
          {draft.name.slice(0, 1) || '+'}
        </span>
        <div>
          <h1 tabIndex={-1} ref={detailTitle}>
            {provider?.name || '自定义服务商'}
          </h1>
          <p className="settings-muted">
            {provider?.builtin ? '模型服务' : '自定义模型服务'} · {protocolNames[draft.protocol]}
          </p>
        </div>
        <label className="settings-enable">
          启用{' '}
          <Switch
            aria-label="启用服务商"
            checked={draft.enabled}
            disabled={Boolean(busy)}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </label>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={Boolean(busy)} className="settings-fieldset">
          <div className="settings-section-heading">
            <h2>连接配置</h2>
            <span className="settings-muted">{dirty ? '未保存' : '已保存'}</span>
          </div>
          {!provider?.builtin && (
            <>
              <label className="settings-field">
                服务商名称
                <Input
                  aria-label="服务商名称"
                  value={draft.name}
                  maxLength={80}
                  placeholder="例如：团队 AI 网关"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label htmlFor="provider-protocol" className="settings-field">
                接口协议
                <Select
                  id="provider-protocol"
                  aria-label="接口协议"
                  disabled={Boolean(busy)}
                  value={draft.protocol}
                  onChange={(protocol) => setDraft({ ...draft, protocol })}
                  options={[
                    { value: 'openai', label: 'OpenAI（兼容接口）' },
                    { value: 'anthropic', label: 'Anthropic' },
                    { value: 'gemini', label: 'Gemini' },
                  ]}
                />
              </label>
            </>
          )}
          <label className="settings-field">
            API 地址
            <Input
              aria-label="API 地址"
              value={draft.baseUrl}
              maxLength={2048}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
            />
          </label>
          <p className="settings-field-hint">
            填写基础地址，包含版本路径（如 /v1）。支持官方服务、代理或自建服务。
          </p>
          <label className="settings-field">
            API Key
            <Input
              aria-label="API Key"
              autoComplete="off"
              type={showKey ? 'text' : 'password'}
              value={key || ''}
              disabled={!settings.secretStorage.available}
              placeholder={
                provider?.hasApiKey && key !== null
                  ? '••••••••（已配置，留空保留）'
                  : '输入或粘贴 API Key，无需认证可留空'
              }
              onChange={(event) => setKey(event.target.value || undefined)}
              suffix={
                <button
                  type="button"
                  className="settings-secret-toggle"
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  aria-pressed={showKey}
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                </button>
              }
            />
          </label>
          <div className="settings-field-hint">
            {key === null
              ? '保存后将清除已有密钥。'
              : provider?.hasApiKey
                ? '密钥已配置。更改接口地址或协议时需重新输入密钥。'
                : '在此输入 API Key，保存后加密保存在本机。'}
            {provider?.hasApiKey && (
              <button
                type="button"
                className="settings-text-button"
                onClick={() => setKey(key === null ? undefined : null)}
              >
                {key === null ? '保留原密钥' : '清除已有密钥'}
              </button>
            )}
          </div>
          {!settings.secretStorage.available && (
            <FeedbackAlert
              source="ProviderSettings-1"
              type="info"
              title={settings.secretStorage.description}
            />
          )}
          <label htmlFor="provider-test-model" className="settings-field">
            测试模型
            <Select
              id="provider-test-model"
              aria-label="测试模型"
              value={testModelId}
              disabled={!provider || dirty || Boolean(busy)}
              onChange={(value) => {
                setTestModelId(value);
                setNotice(null);
              }}
              options={[
                { value: '', label: '仅测试模型列表接口' },
                ...(provider?.models || []).map((model) => ({
                  value: model.id,
                  label: `${model.name === model.id ? model.id : `${model.name} (${model.id})`}${!model.enabled ? ' · 未启用' : ''}`,
                })),
              ]}
            />
          </label>
          <p className="settings-field-hint">
            选择已保存的模型进行测试，未启用的模型也可测试。此选择不更改默认提交模型。
          </p>
          <div className="settings-actions">
            <Button
              disabled={!provider || dirty || Boolean(busy)}
              loading={busy === 'test'}
              onClick={() => void run('test')}
            >
              测试连接
            </Button>
            <Button
              htmlType="submit"
              type="primary"
              icon={<CheckOutlined />}
              loading={busy === 'save'}
              disabled={Boolean(busy) || !dirty}
            >
              保存配置
            </Button>
          </div>
          {dirty && <p className="settings-field-hint">保存配置后可测试连接或获取模型。</p>}
        </fieldset>
      </form>
      {notice && (
        <FeedbackNotice
          source="provider-result"
          type={notice.error ? 'error' : 'success'}
          title={notice.error ? '服务商保存或测试失败' : notice.message}
          description={
            notice.error ? `${notice.message}\n重新加载会放弃尚未保存的配置修改。` : undefined
          }
          eventKey={notice}
          actionLabel={notice.error ? '重新加载配置' : undefined}
          onAction={async () => {
            await useAiSettingsStore.getState().load();
            if (!useAiSettingsStore.getState().error) setNotice(null);
          }}
        />
      )}
      {active.current && (
        <Button
          onClick={() => {
            active.current?.abort();
            active.current = null;
            setBusy(null);
            setNotice({ error: false, message: '已取消操作。' });
          }}
        >
          取消请求
        </Button>
      )}
      <section className="provider-models" aria-label="模型列表">
        <div className="settings-section-heading">
          <h2>
            模型 <span className="count-badge">{draft.models.length}</span>
          </h2>
          <div className="settings-inline-actions">
            <Button
              type="text"
              icon={<ReloadOutlined />}
              disabled={!provider || dirty || Boolean(busy)}
              loading={busy === 'models'}
              onClick={() => void run('models')}
            >
              获取模型
            </Button>
            <Button
              icon={<PlusOutlined />}
              disabled={Boolean(busy)}
              onClick={() => openModelEditor()}
            >
              添加
            </Button>
          </div>
        </div>
        {draft.models.map((model) => (
          <div className="provider-model" key={model.id}>
            <div className="provider-model__copy">
              <strong>{model.name}</strong>
              {isDefaultModel(model.id) && model.enabled && draft.enabled && (
                <Tag color="blue">默认提交模型</Tag>
              )}
              <code>{model.id}</code>
            </div>
            <div className="provider-model__actions">
              <Button
                type="text"
                icon={<EditOutlined />}
                aria-label={`编辑模型 ${model.id}`}
                title="编辑模型"
                disabled={Boolean(busy)}
                onClick={() => openModelEditor(model)}
              />
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={`删除模型 ${model.id}`}
                title="删除模型"
                disabled={Boolean(busy)}
                onClick={() => setModelToDelete(model)}
              />
              <Switch
                aria-label={`启用模型 ${model.id}`}
                checked={model.enabled}
                disabled={Boolean(busy)}
                onChange={(enabled) => {
                  setDraft({
                    ...draft,
                    models: draft.models.map((item) =>
                      item.id === model.id ? { ...item, enabled } : item,
                    ),
                  });
                  setNotice(null);
                }}
              />
            </div>
          </div>
        ))}
        {!draft.models.length && (
          <p className="settings-muted">尚未添加模型。可获取模型列表，或手动输入准确模型 ID。</p>
        )}
        {defaultModelCleared && (
          <FeedbackAlert
            source="ProviderSettings-2"
            type="warning"
            title="保存后将清空默认提交模型"
            description="默认服务商或模型已停用，或默认模型已删除、更改 ID。请在保存后前往“提交生成”重新选择。"
          />
        )}
        <p className="settings-field-hint">
          启用的模型可在“提交生成”中设为默认模型。添加、编辑、删除和启停操作均通过“保存配置”应用。
        </p>
      </section>
      <AluneModal
        size="md"
        glyph="sparkle"
        eyebrow={{ label: '设置', detail: `AI 服务商 · ${protocolNames[draft.protocol]}` }}
        title={modelEditor?.originalId === null ? '手动添加模型' : '编辑模型'}
        description="点击「保存配置」后生效。显示名称留空时使用模型 ID。"
        open={modelEditor !== null}
        onCancel={() => setModelEditor(null)}
        onOk={applyModel}
        okDisabled={!modelEditor?.id.trim() || modelIdTaken}
        okText={modelEditor?.originalId === null ? '添加模型' : '应用修改'}
        hintVerb={modelEditor?.originalId === null ? '添加' : '应用'}
        destroyOnHidden
      >
        <label className="dlg-fld">
          <span className="dlg-fld-label">
            <span>模型 ID</span>
          </span>
          <Input
            className="dlg-mono-input"
            aria-label="模型 ID"
            data-autofocus
            value={modelEditor?.id ?? ''}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            placeholder="服务商提供的准确模型 ID"
            prefix={<DialogIcon name="sparkle" />}
            status={modelIdError ? 'error' : undefined}
            aria-invalid={modelIdError ? true : undefined}
            onChange={(event) => {
              setModelEditor((current) => current && { ...current, id: event.target.value });
              setModelError(null);
            }}
          />
          {modelIdError ? (
            <span className="dlg-fld-hint is-error" role="alert">
              <DialogIcon name="warning" />
              {modelIdError}
            </span>
          ) : (
            <span className="dlg-fld-hint">必须与服务商文档一致，不能包含空格</span>
          )}
        </label>
        <label className="dlg-fld">
          <span className="dlg-fld-label">
            <span>显示名称</span>
            <small>可选</small>
          </span>
          <Input
            aria-label="模型显示名称"
            value={modelEditor?.name ?? ''}
            maxLength={200}
            autoComplete="off"
            placeholder="留空时使用模型 ID"
            prefix={<DialogIcon name="pencil" />}
            status={modelError?.field === 'name' ? 'error' : undefined}
            aria-invalid={modelError?.field === 'name' ? true : undefined}
            onChange={(event) => {
              setModelEditor((current) => current && { ...current, name: event.target.value });
              setModelError(null);
            }}
          />
          {modelError?.field === 'name' && (
            <span className="dlg-fld-hint is-error" role="alert">
              <DialogIcon name="warning" />
              {modelError.message}
            </span>
          )}
        </label>
        {modelEditor?.originalId && isDefaultModel(modelEditor.originalId) && (
          <DialogNote tone="warning" title="这是当前默认提交模型">
            更改 ID 并保存配置后，需要在「提交生成」中重新选择默认模型。
          </DialogNote>
        )}
      </AluneModal>
      <AluneModal
        level={1}
        danger
        tone="warning"
        size="sm"
        glyph="sparkle"
        eyebrow={{ label: '设置', detail: 'AI 服务商' }}
        title="删除模型？"
        description={
          <>
            确定从此服务商移除
            {modelToDelete && modelToDelete.name !== modelToDelete.id
              ? `“${modelToDelete.name}”（`
              : ''}
            <code>{modelToDelete?.id}</code>
            {modelToDelete && modelToDelete.name !== modelToDelete.id ? '）' : ''}
            吗？点击「保存配置」后生效。
          </>
        }
        open={modelToDelete !== null}
        onCancel={() => setModelToDelete(null)}
        onOk={deleteModel}
        okText="删除模型"
        hintVerb="删除"
        body={modelToDelete && isDefaultModel(modelToDelete.id) ? 'default' : 'flush'}
        destroyOnHidden
      >
        {modelToDelete && isDefaultModel(modelToDelete.id) && (
          <DialogNote tone="warning" title="这是当前默认提交模型">
            删除并保存配置后，需要在「提交生成」中重新选择默认模型。
          </DialogNote>
        )}
      </AluneModal>
    </>
  );
}

import { FeedbackAlert } from '@alune/ui';
import { FeedbackNotice } from '@alune/ui';
import { useEffect, useState } from 'react';
import { Button, Input, Select } from '@alune/ui';
import { CheckOutlined } from '@ant-design/icons';
import type { AiSettings, CommitGenerationPreferences } from '@alune/shared';
import { aiApi, aiError } from '../../api/ai';
import { useAiSettingsStore } from '../../stores/aiSettingsStore';

export function CommitSettings({
  settings,
  onProviders,
}: {
  settings: AiSettings;
  onProviders: () => void;
}) {
  const [draft, setDraft] = useState(settings.commit);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string } | null>(null);
  useEffect(() => setDraft(settings.commit), [settings.revision]);
  const providers = settings.providers.filter((p) => p.enabled && p.models.some((m) => m.enabled));
  const models =
    providers.find((p) => p.id === draft.providerId)?.models.filter((m) => m.enabled) || [];
  const change = (patch: Partial<CommitGenerationPreferences>) => {
    setDraft({ ...draft, ...patch });
    setNotice(null);
  };
  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      useAiSettingsStore.getState().accept(await aiApi.saveCommit(draft, settings.revision));
    } catch (error) {
      setNotice({ message: aiError(error) });
    } finally {
      setBusy(false);
    }
  };
  const summary =
    draft.language === 'zh-CN'
      ? '支持根据暂存改动生成提交信息'
      : 'generate commit messages from staged changes';
  return (
    <div className="settings-page-content">
      <h1>提交生成</h1>
      <p className="settings-lead">让每次提交清楚地说明这次改动。设置应用于此设备的所有仓库。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="settings-fieldset">
          <h2>默认模型</h2>
          {!providers.length && (
            <FeedbackAlert
              source="CommitSettings-1"
              type="info"
              title="尚无已启用的模型"
              description={
                <span>
                  在{' '}
                  <button type="button" className="settings-text-button" onClick={onProviders}>
                    AI 服务商
                  </button>{' '}
                  中配置并启用服务商和模型。
                </span>
              }
            />
          )}
          <div className="settings-form-row">
            <label htmlFor="commit-provider" className="settings-field">
              服务商
              <Select
                id="commit-provider"
                aria-label="默认服务商"
                disabled={busy}
                value={draft.providerId || undefined}
                options={providers.map((p) => ({ value: p.id, label: p.name }))}
                onChange={(value) => change({ providerId: value || null, modelId: null })}
                allowClear
                placeholder="选择服务商"
              />
            </label>
            <label htmlFor="commit-model" className="settings-field">
              模型
              <Select
                id="commit-model"
                aria-label="默认模型"
                disabled={busy}
                value={draft.modelId || undefined}
                options={models.map((m) => ({ value: m.id, label: `${m.name} · ${m.id}` }))}
                onChange={(value) => change({ modelId: value || null })}
                allowClear
                placeholder="选择模型"
              />
            </label>
          </div>
          <p className="settings-field-hint">
            仅列出已启用的服务商和模型。
            <button type="button" className="settings-text-button" onClick={onProviders}>
              管理服务商
            </button>
          </p>
          <h2 className="settings-subheading">生成偏好</h2>
          <div className="settings-form-row">
            <label htmlFor="commit-language" className="settings-field">
              输出语言
              <Select
                id="commit-language"
                aria-label="输出语言"
                disabled={busy}
                value={draft.language}
                options={[
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'en', label: 'English' },
                ]}
                onChange={(language) => change({ language })}
              />
            </label>
            <label htmlFor="commit-format" className="settings-field">
              提交格式
              <Select
                id="commit-format"
                aria-label="提交格式"
                disabled={busy}
                value={draft.format}
                options={[
                  { value: 'conventional', label: 'Conventional Commits' },
                  { value: 'natural', label: '自然语言' },
                ]}
                onChange={(format) => change({ format })}
              />
            </label>
          </div>
          <label className="settings-field">
            补充提示词（可选）
            <Input.TextArea
              aria-label="补充提示词"
              value={draft.prompt}
              rows={4}
              maxLength={4000}
              showCount
              placeholder="例如：摘要保持简洁，正文说明改动原因；必要时注明关联 issue。"
              onChange={(event) => change({ prompt: event.target.value })}
            />
          </label>
          <div className="commit-format-preview">
            <span>格式预览</span>
            <code>
              {draft.format === 'conventional' ? 'feat(git): ' : ''}
              {summary}
            </code>
            <p>
              {draft.language === 'zh-CN'
                ? '说明主要改动与原因，必要时补充正文。'
                : 'Describe the main changes and their purpose when a body is useful.'}
            </p>
          </div>
          <FeedbackAlert
            source="CommitSettings-2"
            type="info"
            title="仅已暂存改动"
            description="暂存差异将发送给你选择的 AI 服务商。二进制文件仅提供变更信息；超过 96 KiB 时请减少暂存范围。生成后可编辑、撤销，由你主动提交。"
          />
          <div className="settings-actions settings-actions--end">
            <Button htmlType="submit" type="primary" icon={<CheckOutlined />} loading={busy}>
              保存设置
            </Button>
          </div>
        </fieldset>
      </form>
      {notice && (
        <FeedbackNotice
          source="commit-settings-result"
          type="error"
          title="提交生成设置保存失败"
          description={`${notice.message}\n重新加载会放弃尚未保存的设置修改。`}
          eventKey={notice}
          actionLabel="重新加载设置"
          onAction={async () => {
            await useAiSettingsStore.getState().load();
            if (!useAiSettingsStore.getState().error) setNotice(null);
          }}
        />
      )}
    </div>
  );
}

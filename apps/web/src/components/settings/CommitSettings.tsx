import { useEffect, useState } from 'react';
import { Alert, Button, Input } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import type { AiSettings, CommitGenerationPreferences } from '@remote-git/shared';
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
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
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
      setNotice({ error: false, message: '提交生成设置已保存。' });
    } catch (error) {
      setNotice({ error: true, message: aiError(error) });
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
      <p className="settings-lead">让每次提交清楚地说明这次改动。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="settings-fieldset">
          <h2>默认模型</h2>
          {!providers.length && (
            <Alert
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
            <label className="settings-field">
              服务商
              <select
                aria-label="默认服务商"
                value={draft.providerId || ''}
                onChange={(event) =>
                  change({ providerId: event.target.value || null, modelId: null })
                }
              >
                <option value="">选择服务商</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              模型
              <select
                aria-label="默认模型"
                value={draft.modelId || ''}
                onChange={(event) => change({ modelId: event.target.value || null })}
              >
                <option value="">选择模型</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.id}
                  </option>
                ))}
              </select>
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
            <label className="settings-field">
              输出语言
              <select
                aria-label="输出语言"
                value={draft.language}
                onChange={(event) =>
                  change({
                    language: event.target.value as CommitGenerationPreferences['language'],
                  })
                }
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="settings-field">
              提交格式
              <select
                aria-label="提交格式"
                value={draft.format}
                onChange={(event) =>
                  change({ format: event.target.value as CommitGenerationPreferences['format'] })
                }
              >
                <option value="conventional">Conventional Commits</option>
                <option value="natural">自然语言</option>
              </select>
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
          <Alert
            type="info"
            showIcon
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
        <Alert
          role={notice.error ? 'alert' : 'status'}
          type={notice.error ? 'error' : 'success'}
          showIcon
          title={notice.message}
          action={
            notice.error && (
              <Button
                size="small"
                title="重新加载并放弃尚未保存的设置修改"
                onClick={() => void useAiSettingsStore.getState().load()}
              >
                重新加载设置
              </Button>
            )
          }
        />
      )}
    </div>
  );
}

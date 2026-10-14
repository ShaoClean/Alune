import { useEffect, useState } from 'react';
import { Button, FeedbackAlert, FeedbackNotice, Input, InputNumber, Select } from '@alune/ui';
import {
  CheckOutlined,
  FolderOpenOutlined,
  ProfileOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import {
  LOG_LEVELS,
  LOGGING_LIMITS,
  type LoggingSettings as Settings,
  type SaveLoggingSettings,
} from '@alune/shared';
import { logBridge, loggingApi, loggingError, openLogViewer } from '../../api/logging';

const levelLabels: Record<(typeof LOG_LEVELS)[number], string> = {
  DEBUG: 'DEBUG · 全部记录，日志量较大',
  INFO: 'INFO · 常规操作与结果（推荐）',
  WARN: 'WARN · 只记录警告和错误',
  ERROR: 'ERROR · 只记录错误',
};

const toDraft = (settings: Settings): SaveLoggingSettings & { directoryText: string } => ({
  customDirectory: settings.customDirectory,
  level: settings.level,
  retentionDays: settings.retentionDays,
  maxTotalMB: settings.maxTotalMB,
  directoryText: settings.customDirectory ?? '',
});

export function LoggingSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof toDraft> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const bridge = logBridge();

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const value = await loggingApi.settings();
      setSettings(value);
      setDraft(toDraft(value));
    } catch (error) {
      setLoadError(loggingError(error, '无法读取日志设置，请检查本地服务后重试。'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (!settings || !draft)
    return (
      <div className="settings-page-content" role="status">
        <h1>日志</h1>
        {loading ? (
          '正在读取日志设置…'
        ) : (
          <>
            {loadError} <Button onClick={() => void load()}>重新加载</Button>
          </>
        )}
      </div>
    );

  const change = (patch: Partial<typeof draft>) => {
    setDraft({ ...draft, ...patch });
    setNotice(null);
  };
  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const directory = draft.directoryText.trim();
      const value = await loggingApi.save({
        customDirectory: directory && directory !== settings.defaultDirectory ? directory : null,
        level: draft.level,
        retentionDays: draft.retentionDays,
        maxTotalMB: draft.maxTotalMB,
      });
      setSettings(value);
      setDraft(toDraft(value));
      setNotice({ error: false, text: '日志设置已保存并立即生效。' });
    } catch (error) {
      setNotice({ error: true, text: loggingError(error, '日志设置保存失败，请重试。') });
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    try {
      const directory = await bridge?.chooseDirectory();
      if (directory) change({ directoryText: directory });
    } catch (error) {
      setNotice({ error: true, text: loggingError(error, '无法打开目录选择器。') });
    }
  };
  const openDirectory = async () => {
    try {
      await bridge?.openDirectory();
    } catch (error) {
      setNotice({
        error: true,
        text: error instanceof Error ? error.message : '无法打开日志目录。',
      });
    }
  };
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(settings.directory);
      setNotice({ error: false, text: '已复制日志目录路径。' });
    } catch {
      setNotice({ error: true, text: '复制失败，请手动选择路径文本复制。' });
    }
  };

  return (
    <div className="settings-page-content">
      <h1>日志</h1>
      <p className="settings-lead">
        记录 Git、SSH、托管平台、AI
        请求与应用更新的运行情况，用于排查问题。令牌、密码和私钥会自动脱敏，不记录文件内容、Diff 和
        AI 请求正文。
      </p>
      {notice && (
        <FeedbackNotice
          source="logging-result"
          type={notice.error ? 'error' : 'success'}
          title={notice.error ? '日志设置未保存' : notice.text}
          description={notice.text}
          eventKey={notice}
        />
      )}
      <div className="settings-actions logging-actions">
        <Button type="primary" icon={<ProfileOutlined />} onClick={() => void openLogViewer()}>
          打开实时日志
        </Button>
        {bridge ? (
          <Button icon={<FolderOpenOutlined />} onClick={() => void openDirectory()}>
            打开日志目录
          </Button>
        ) : (
          <Button onClick={() => void copyPath()}>复制日志目录路径</Button>
        )}
      </div>
      <p className="settings-field-hint">
        桌面端可通过菜单“帮助 → 查看日志”或 <kbd>⌘/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd>{' '}
        打开独立日志窗口。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy} className="settings-fieldset">
          <h2>日志目录</h2>
          {settings.fallbackReason && (
            <FeedbackAlert
              source="LoggingSettings-fallback"
              type="warning"
              title="自定义日志目录不可用"
              description={settings.fallbackReason}
            />
          )}
          <p className="settings-field-hint">
            当前写入：<code className="logging-path">{settings.directory}</code>
          </p>
          <label htmlFor="logging-directory" className="settings-field">
            自定义目录（留空使用默认目录）
            <Input
              id="logging-directory"
              aria-label="自定义日志目录"
              value={draft.directoryText}
              placeholder={`默认：${settings.defaultDirectory}`}
              spellCheck={false}
              onChange={(event) => change({ directoryText: event.target.value })}
            />
          </label>
          <div className="settings-actions logging-actions">
            {bridge && (
              <Button icon={<FolderOpenOutlined />} onClick={() => void choose()}>
                选择目录…
              </Button>
            )}
            <Button
              icon={<RollbackOutlined />}
              disabled={!draft.directoryText}
              onClick={() => change({ directoryText: '' })}
            >
              恢复默认目录
            </Button>
          </div>
          <p className="settings-field-hint">
            {bridge
              ? '目录需要可写；保存时会检查，失败时保留原设置。'
              : 'Web 模式下填写本地服务所在机器上的绝对路径；保存时会检查目录是否可写。'}
          </p>
          <h2 className="settings-subheading">记录与保留</h2>
          <label htmlFor="logging-level" className="settings-field">
            最低记录等级
            <Select
              id="logging-level"
              aria-label="最低记录等级"
              value={draft.level}
              options={LOG_LEVELS.map((level) => ({ value: level, label: levelLabels[level] }))}
              onChange={(level) => change({ level })}
            />
          </label>
          <div className="settings-form-row">
            <label htmlFor="logging-retention" className="settings-field">
              保留天数
              <InputNumber
                id="logging-retention"
                aria-label="保留天数"
                min={LOGGING_LIMITS.retentionDays.min}
                max={LOGGING_LIMITS.retentionDays.max}
                precision={0}
                value={draft.retentionDays}
                suffix="天"
                onChange={(value) =>
                  change({ retentionDays: value ?? LOGGING_LIMITS.retentionDays.default })
                }
              />
            </label>
            <label htmlFor="logging-size" className="settings-field">
              总大小上限
              <InputNumber
                id="logging-size"
                aria-label="总大小上限"
                min={LOGGING_LIMITS.maxTotalMB.min}
                max={LOGGING_LIMITS.maxTotalMB.max}
                precision={0}
                value={draft.maxTotalMB}
                suffix="MB"
                onChange={(value) =>
                  change({ maxTotalMB: value ?? LOGGING_LIMITS.maxTotalMB.default })
                }
              />
            </label>
          </div>
          <p className="settings-field-hint">
            每天一个文件，单个文件超过 {LOGGING_LIMITS.fileMB} MB
            时自动分卷。超过保留天数或总大小时，从最早的文件开始清理。
          </p>
          <div className="settings-actions settings-actions--end">
            <Button htmlType="submit" type="primary" icon={<CheckOutlined />} loading={busy}>
              保存设置
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}

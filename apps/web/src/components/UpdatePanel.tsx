import { FeedbackAlert } from './FeedbackAlert';
import { FeedbackNotice } from './Feedback';
import { Button, Progress, Space, Spin, Typography } from 'antd';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { DesktopUpdates, UpdateState } from '../types/desktop-updates';
import { ReleaseNotes } from './ReleaseNotes';
import { AluneModal, DialogHints, Kbd } from './AluneModal';
import { DialogCard, DialogNote, DialogProgress, DialogStat, DialogStats } from './DialogParts';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';

const labels: Record<UpdateState['status'], string> = {
  idle: '检查是否有新版本',
  checking: '正在检查 GitHub Releases…',
  'not-available': '当前已是最新稳定版本',
  available: '发现新版本',
  downloading: '正在下载安装包…',
  downloaded: '安装包已下载并通过校验',
  installing: '正在准备更新并重启安装，请稍候…',
  error: '更新未完成',
};
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;

type Invoke = (action: Exclude<keyof DesktopUpdates, 'subscribe'>) => Promise<void>;

/** Which actions the current state allows; shared by the settings page and the dialog. */
const updateActions = (state: UpdateState | null) => ({
  busy: Boolean(state && ['checking', 'downloading', 'installing'].includes(state.status)),
  ready:
    state?.status === 'downloaded' ||
    (state?.status === 'error' && ['install', 'open'].includes(state.error?.action || '')),
  canDownload: Boolean(
    state?.latestVersion &&
    (state.status === 'available' ||
      (state.status === 'error' && state.error?.action === 'download')),
  ),
});

function OrbButton({
  icon,
  children,
  onClick,
}: {
  icon: DialogIconName;
  children: string;
  onClick: () => void;
}) {
  return (
    <Button type="primary" className="has-orb" autoFocus onClick={onClick}>
      <span>{children}</span>
      <span className="dlg-orb" aria-hidden="true">
        <DialogIcon name={icon} />
      </span>
    </Button>
  );
}

export function UpdatePanel({
  open,
  onClose,
  state,
  error,
  invoke,
}: {
  open: boolean;
  onClose: () => void;
  state: UpdateState | null;
  error: string | null;
  invoke: Invoke;
}) {
  const { busy, ready, canDownload } = updateActions(state);
  const downloading = state?.status === 'downloading';
  const latest =
    state?.latestVersion ?? (state?.status === 'not-available' ? state.currentVersion : null);
  return (
    <AluneModal
      size={560}
      glyph="download"
      eyebrow={{ label: '设置', detail: '版本更新 · GitHub Releases' }}
      title={<span aria-live="polite">{state ? labels[state.status] : '正在读取版本信息'}</span>}
      open={open}
      onCancel={onClose}
      hints={
        <DialogHints>
          <span>
            <Kbd>Esc</Kbd> 关闭
          </span>
          {downloading ? (
            <>
              <i />
              <span>后台继续下载</span>
            </>
          ) : null}
        </DialogHints>
      }
      footer={
        state ? (
          <>
            {downloading ? (
              <Button onClick={() => void invoke('cancel')}>取消下载</Button>
            ) : !canDownload && !ready ? (
              <Button
                loading={state.status === 'checking'}
                disabled={!state.supported || busy}
                onClick={() => void invoke('check')}
              >
                {state.status === 'checking' ? '正在检查…' : '检查更新'}
              </Button>
            ) : null}
            {canDownload && (
              <OrbButton
                icon={state.error ? 'refresh' : 'download'}
                onClick={() => void invoke('download')}
              >
                {state.error ? '重新下载' : '下载更新'}
              </OrbButton>
            )}
            {ready && (
              <OrbButton icon="refresh" onClick={() => void invoke('install')}>
                重启安装
              </OrbButton>
            )}
          </>
        ) : (
          <Button onClick={onClose}>关闭</Button>
        )
      }
    >
      {error && (
        <DialogNote
          tone="danger"
          role="alert"
          title="无法连接桌面更新服务"
          action={
            <Button size="small" onClick={() => void invoke('getState')}>
              重新连接
            </Button>
          }
        >
          {error}
        </DialogNote>
      )}
      {!state ? (
        <DialogProgress label="正在读取版本信息" />
      ) : (
        <>
          <DialogCard>
            <DialogStats>
              <DialogStat value={state.currentVersion} label="当前版本" />
              {state.status === 'checking' || !latest ? (
                <DialogStat value={state.status === 'checking' ? '…' : '—'} label="最新版本" off />
              ) : state.status === 'not-available' ? (
                <DialogStat value={latest} label="最新版本 · 一致" tone="success" />
              ) : (
                <DialogStat value={latest} label="最新版本" tone="info" />
              )}
            </DialogStats>
          </DialogCard>
          {state.status === 'checking' && <DialogProgress />}
          {state.progress && (
            <DialogProgress
              value={state.progress.percent / 100}
              label={
                <code>
                  {bytes(state.progress.transferred)} / {bytes(state.progress.total)} ·{' '}
                  {bytes(state.progress.bytesPerSecond)}/s
                </code>
              }
            />
          )}
          {!state.supported && (
            <DialogNote tone="info" title="当前运行方式不支持更新">
              请使用已安装的正式桌面应用。Linux 需要运行 AppImage；开发环境不连接更新源。
            </DialogNote>
          )}
          {state.error && (
            <DialogNote tone="danger" role="alert" title="版本更新未完成">
              {state.error.message}
            </DialogNote>
          )}
          {state.latestVersion && state.status !== 'not-available' && (
            <>
              <p className="dlg-sub">
                <span>更新说明</span>
                <small>v{state.latestVersion}</small>
              </p>
              <DialogCard pad>
                <ReleaseNotes notes={state.releaseNotes} />
              </DialogCard>
              <DialogNote quiet>
                下载完成后，点击「重启安装」将关闭当前 SSH
                连接，安装新版本并重新打开应用。普通退出不会自动安装。
              </DialogNote>
            </>
          )}
        </>
      )}
    </AluneModal>
  );
}

export function UpdatePanelContent({
  state,
  error,
  invoke,
}: {
  state: UpdateState | null;
  error: string | null;
  invoke: Invoke;
}) {
  const { busy, ready, canDownload } = updateActions(state);
  return (
    <div className="update-panel" data-testid="update-panel">
      <FeedbackNotice
        source="update-bridge"
        title={error ? '无法连接桌面更新服务' : null}
        description={error || undefined}
        actionLabel="重新连接"
        onAction={() => invoke('getState')}
      />
      {!state ? (
        <Spin tip="正在读取版本信息">
          <div style={{ minHeight: 80 }} />
        </Spin>
      ) : (
        <>
          <div className="update-panel__versions">
            <div>
              <Typography.Text type="secondary">当前版本</Typography.Text>
              <strong>v{state.currentVersion}</strong>
            </div>
            {state.latestVersion && (
              <div>
                <Typography.Text type="secondary">最新版本</Typography.Text>
                <strong>v{state.latestVersion}</strong>
              </div>
            )}
          </div>
          <FeedbackNotice
            source="update-status"
            type={
              state.status === 'downloaded' || state.status === 'not-available' ? 'success' : 'info'
            }
            title={!state.error && state.supported ? labels[state.status] : null}
            eventKey={`${state.currentVersion}:${state.latestVersion}:${state.status}`}
            resetOnClear={false}
          />
          {!state.supported && (
            <FeedbackAlert
              source="UpdatePanel-1"
              type="info"
              title="当前运行方式不支持更新"
              description="请使用已安装的正式桌面应用。Linux 需要运行 AppImage；开发环境不连接更新源。"
            />
          )}
          <FeedbackNotice
            source="update-result"
            title={state.error ? '版本更新未完成' : null}
            description={state.error?.message}
            mode={state.background ? 'notification' : 'modal'}
            eventKey={state.revision}
            actionLabel={
              ready ? '重启安装' : state.error?.action === 'download' ? '重新下载' : '检查更新'
            }
            onAction={() =>
              invoke(ready ? 'install' : state.error?.action === 'download' ? 'download' : 'check')
            }
            busy={busy}
          />
          {state.progress && (
            <div>
              <Progress percent={Math.floor(state.progress.percent)} />
              <Typography.Text type="secondary">
                {bytes(state.progress.transferred)} / {bytes(state.progress.total)} ·{' '}
                {bytes(state.progress.bytesPerSecond)}/s
              </Typography.Text>
            </div>
          )}
          {state.latestVersion && (
            <div className="update-panel__notes">
              <Typography.Text strong>更新说明</Typography.Text>
              <ReleaseNotes notes={state.releaseNotes} />
            </div>
          )}
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            下载完成后，点击“重启安装”将关闭当前 SSH
            连接，安装新版本并重新打开应用。普通退出不会自动安装。
          </Typography.Paragraph>
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              loading={state.status === 'checking'}
              disabled={!state.supported || busy || ready}
              onClick={() => void invoke('check')}
            >
              检查更新
            </Button>
            {canDownload && (
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={() => void invoke('download')}
              >
                {state.error ? '重新下载' : '下载更新'}
              </Button>
            )}
            {state.status === 'downloading' && (
              <Button onClick={() => void invoke('cancel')}>取消下载</Button>
            )}
            {ready && (
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={() => void invoke('install')}
              >
                重启安装
              </Button>
            )}
          </Space>
        </>
      )}
    </div>
  );
}

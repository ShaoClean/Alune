import { Alert, Button, Modal, Progress, Space, Spin, Typography } from 'antd';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import type { DesktopUpdates, UpdateState } from '../types/desktop-updates';

const labels: Record<UpdateState['status'], string> = {
  idle: '检查是否有新版本', checking: '正在检查 GitHub Releases…', 'not-available': '当前已是最新稳定版本',
  available: '发现新版本', downloading: '正在下载安装包…', downloaded: '安装包已下载并通过校验',
  installing: '正在关闭本地服务并启动安装程序…', error: '更新未完成',
};
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;

export function UpdatePanel({ open, onClose, state, error, invoke }: {
  open: boolean; onClose: () => void; state: UpdateState | null; error: string | null;
  invoke: (action: Exclude<keyof DesktopUpdates, 'subscribe'>) => Promise<void>;
}) {
  const busy = state && ['checking', 'downloading', 'installing'].includes(state.status);
  const ready = state?.status === 'downloaded' || (state?.status === 'error' && ['install', 'open'].includes(state.error?.action || ''));
  const canDownload = state?.latestVersion && (state.status === 'available' || (state.status === 'error' && state.error?.action === 'download'));
  return (
    <Modal title="设置 · 版本更新" open={open} onCancel={onClose} footer={null} width={560}>
      <div className="update-panel" data-testid="update-panel">
        {error && <Alert type="error" showIcon title={error} />}
        {!state ? <Spin tip="正在读取版本信息"><div style={{ minHeight: 80 }} /></Spin> : <>
          <div className="update-panel__versions">
            <div><Typography.Text type="secondary">当前版本</Typography.Text><strong>v{state.currentVersion}</strong></div>
            {state.latestVersion && <div><Typography.Text type="secondary">最新版本</Typography.Text><strong>v{state.latestVersion}</strong></div>}
          </div>
          <div role="status" aria-live="polite">{labels[state.status]}</div>
          {!state.supported && <Alert type="info" showIcon title="当前运行方式不支持更新" description="请使用已安装的正式桌面应用。Linux 需要运行 AppImage；开发环境不连接更新源。" />}
          {state.error && <Alert type="error" showIcon title={state.error.message} />}
          {state.progress && <div>
            <Progress percent={Math.floor(state.progress.percent)} />
            <Typography.Text type="secondary">{bytes(state.progress.transferred)} / {bytes(state.progress.total)} · {bytes(state.progress.bytesPerSecond)}/s</Typography.Text>
          </div>}
          {state.latestVersion && <div className="update-panel__notes">
            <Typography.Text strong>更新说明</Typography.Text>
            <pre>{state.releaseNotes || '此版本未提供更新说明。'}</pre>
          </div>}
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {state.installMode === 'manual' ? 'macOS 下载完成后，请打开 DMG，将 RemoteGit 拖入“应用程序”完成安装。' : '下载完成后，点击“重启安装”将关闭当前 SSH 连接并安装新版本。普通退出不会自动安装。'}
          </Typography.Paragraph>
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={state.status === 'checking'} disabled={!state.supported || Boolean(busy) || Boolean(ready)} onClick={() => void invoke('check')}>检查更新</Button>
            {canDownload && <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void invoke('download')}>{state.error ? '重新下载' : '下载更新'}</Button>}
            {state.status === 'downloading' && <Button onClick={() => void invoke('cancel')}>取消下载</Button>}
            {ready && (state.installMode === 'manual' ? <>
              <Button type="primary" onClick={() => void invoke('openFile')}>打开安装包</Button>
              <Button onClick={() => void invoke('revealFile')}>显示文件位置</Button>
            </> : <Button type="primary" onClick={() => void invoke('install')}>重启安装</Button>)}
          </Space>
        </>}
      </div>
    </Modal>
  );
}

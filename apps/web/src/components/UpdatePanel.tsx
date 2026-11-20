import {
  AluneModal,
  Button,
  DialogCard,
  DialogHints,
  DialogIcon,
  DialogNote,
  DialogProgress,
  DialogStat,
  DialogStats,
  FeedbackNotice,
  Kbd,
  MoonLoader,
  OrbButton,
} from '@alune/ui';
import { ReloadOutlined } from '@alune/ui/icons';
import type { DesktopUpdates, UpdateState } from '../types/desktop-updates';
import { BrandIcon } from './BrandIcon';
import { ReleaseNotes } from './ReleaseNotes';

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

/** One application-wide update source, including errors raised after leaving settings. */
export function DesktopUpdateFeedback({
  state,
  error,
  invoke,
  onUpdates,
  watching = false,
}: {
  state: UpdateState | null;
  error: string | null;
  invoke: Invoke;
  onUpdates: () => void;
  /** The settings update page is open and already shows every state. */
  watching?: boolean;
}) {
  const { busy, ready } = updateActions(state);
  const failure = error || state?.error?.message;
  const available = state?.status === 'available';
  const downloaded = state?.status === 'downloaded';
  // Only results that need the user become notices; progress lives on the settings page.
  const title = failure
    ? error
      ? '无法连接桌面更新服务'
      : '版本更新未完成'
    : state?.supported && (available || downloaded)
      ? available
        ? `Alune v${state.latestVersion} 可用`
        : labels.downloaded
      : null;
  const action = error
    ? 'getState'
    : ready
      ? 'install'
      : state?.error?.action === 'download'
        ? 'download'
        : 'check';
  return (
    <FeedbackNotice
      source="desktop-update"
      title={title}
      description={failure || (available ? '新版本已发布，可查看更新说明并下载安装。' : undefined)}
      type={failure ? 'error' : downloaded ? 'success' : 'info'}
      mode={failure ? 'modal' : 'manual'}
      icon="download"
      autoOpen={!watching && Boolean(failure || (available && state?.background))}
      // One unread result per version and outcome, however often the state is polled.
      eventKey={
        failure
          ? `error:${error || `${state?.error?.action}:${failure}`}`
          : `${state?.status}:${state?.latestVersion}`
      }
      read={watching}
      resetOnClear={false}
      actionLabel={
        failure
          ? error
            ? '重新连接'
            : ready
              ? '重启安装'
              : action === 'download'
                ? '重新下载'
                : '检查更新'
          : available || downloaded
            ? '查看更新'
            : undefined
      }
      onAction={failure ? () => invoke(action) : onUpdates}
      busy={busy}
    />
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
                autoFocus
                icon={state.error ? 'refresh' : 'download'}
                onClick={() => void invoke('download')}
              >
                {state.error ? '重新下载' : '下载更新'}
              </OrbButton>
            )}
            {ready && (
              <OrbButton icon="refresh" autoFocus onClick={() => void invoke('install')}>
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

const platformLabel = (platform: string) =>
  ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' })[platform] || platform;

const statusTone = (state: UpdateState): 'neutral' | 'accent' | 'success' | 'danger' | 'warn' => {
  if (!state.supported) return 'warn';
  if (state.status === 'downloaded' || state.status === 'not-available') return 'success';
  if (state.status === 'error') return 'danger';
  if (['available', 'downloading', 'checking', 'installing'].includes(state.status)) {
    return 'accent';
  }
  return 'neutral';
};

const notesBadgeLabel = (status: UpdateState['status']) => {
  if (status === 'downloaded') return '已校验就绪';
  if (status === 'downloading') return '下载中';
  if (status === 'installing') return '准备安装';
  return '新版本说明';
};

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
  const downloading = state?.status === 'downloading';
  const hasLatest = Boolean(state?.latestVersion && state.status !== 'not-available');
  const tone = state ? statusTone(state) : 'neutral';
  const percent = state?.progress ? Math.min(100, Math.max(0, Math.floor(state.progress.percent))) : 0;

  return (
    <div className="update-panel" data-testid="update-panel">
      {error && (
        <div className="update-callout" data-tone="danger" role="alert">
          <DialogIcon name="warning" className="update-callout__icon" />
          <div className="update-callout__body">
            <p className="update-callout__title">无法连接桌面更新服务</p>
            <p className="update-callout__desc">{error}</p>
          </div>
          <Button size="small" onClick={() => void invoke('getState')}>
            重新连接
          </Button>
        </div>
      )}

      {!state ? (
        <section className="update-hero update-hero--loading" data-tone="neutral">
          <div className="update-hero__loading" role="status">
            <MoonLoader />
            <span>正在读取版本信息…</span>
          </div>
        </section>
      ) : (
        <>
          <section className="update-hero" data-tone={tone}>
            <div className="update-hero__top">
              <div className="update-hero__identity">
                <div className="update-hero__mascot">
                  <BrandIcon className="update-hero__mascot-img" />
                </div>
                <div className="update-hero__summary">
                  <div className="update-hero__status-row">
                    <span className="update-status-pill" data-tone={tone} role="status">
                      <span
                        className={`update-status-pill__dot${busy ? ' is-pulsing' : ''}`}
                        aria-hidden="true"
                      />
                      {!state.supported ? '当前运行方式不支持更新' : labels[state.status]}
                    </span>
                  </div>
                  <div className="update-hero__versions">
                    <span className="update-hero__current">Alune v{state.currentVersion}</span>
                    {hasLatest && state.latestVersion && (
                      <>
                        <span className="update-hero__arrow" aria-hidden="true">
                          <DialogIcon name="arrow-right" />
                        </span>
                        <span className={`update-hero__target${ready ? ' is-ready' : ''}`}>
                          v{state.latestVersion}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="update-hero__actions">
                {downloading ? (
                  <Button onClick={() => void invoke('cancel')}>取消下载</Button>
                ) : ready ? (
                  <OrbButton icon="refresh" onClick={() => void invoke('install')}>
                    重启安装
                  </OrbButton>
                ) : canDownload ? (
                  <>
                    <Button
                      icon={<ReloadOutlined />}
                      disabled={!state.supported || busy}
                      onClick={() => void invoke('check')}
                    >
                      检查更新
                    </Button>
                    <OrbButton
                      icon={state.error ? 'refresh' : 'download'}
                      onClick={() => void invoke('download')}
                    >
                      {state.error ? '重新下载' : '下载更新'}
                    </OrbButton>
                  </>
                ) : state.supported && !busy ? (
                  <OrbButton icon="refresh" onClick={() => void invoke('check')}>
                    检查更新
                  </OrbButton>
                ) : (
                  <Button
                    icon={<ReloadOutlined />}
                    loading={state.status === 'checking'}
                    disabled={!state.supported || busy}
                    onClick={() => void invoke('check')}
                  >
                    {state.status === 'checking' ? '正在检查…' : '检查更新'}
                  </Button>
                )}
              </div>
            </div>

            {state.progress ? (
              <div className="update-hero__progress">
                <div className="update-hero__progress-head">
                  <span className="update-hero__progress-title">
                    正在下载 Alune{state.latestVersion ? ` v${state.latestVersion}` : ''} ·{' '}
                    {percent}%
                  </span>
                  <span className="update-hero__progress-stats">
                    {bytes(state.progress.transferred)} / {bytes(state.progress.total)} ·{' '}
                    {bytes(state.progress.bytesPerSecond)}/s
                  </span>
                </div>
                <div
                  className="update-progress-track"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="update-progress-bar" style={{ width: `${percent}%` }} />
                </div>
              </div>
            ) : state.status === 'checking' || state.status === 'installing' ? (
              <div className="update-hero__progress">
                <div className="update-hero__progress-head">
                  <span className="update-hero__progress-title">
                    {state.status === 'checking'
                      ? '正在连接 GitHub Releases 获取最新版本信息…'
                      : '正在校验并准备重启安装新版本…'}
                  </span>
                  <span className="update-hero__progress-stats">
                    {state.status === 'checking' ? '检测中' : '请勿强制退出'}
                  </span>
                </div>
                <div className="update-progress-track" role="progressbar" aria-busy="true">
                  <div className="update-progress-bar is-indeterminate" />
                </div>
              </div>
            ) : (
              <div className="update-hero__ribbon">
                <div className="update-ribbon-cell">
                  <span className="update-ribbon-cell__label">当前版本</span>
                  <span className="update-ribbon-cell__value is-mono">v{state.currentVersion}</span>
                </div>
                <div className="update-ribbon-cell">
                  <span className="update-ribbon-cell__label">最新版本</span>
                  <span className="update-ribbon-cell__value is-mono">
                    {hasLatest && state.latestVersion
                      ? `v${state.latestVersion}`
                      : state.status === 'not-available'
                        ? `v${state.currentVersion}（一致）`
                        : '未检查'}
                  </span>
                </div>
                <div className="update-ribbon-cell">
                  <span className="update-ribbon-cell__label">运行平台</span>
                  <span className="update-ribbon-cell__value">{platformLabel(state.platform)}</span>
                </div>
                <div className="update-ribbon-cell">
                  <span className="update-ribbon-cell__label">安装方式</span>
                  <span className="update-ribbon-cell__value">下载校验后重启安装</span>
                </div>
              </div>
            )}
          </section>

          {!state.supported && (
            <div className="update-callout" data-tone="info" role="status">
              <DialogIcon name="info" className="update-callout__icon" />
              <div className="update-callout__body">
                <p className="update-callout__title">当前运行方式不支持更新</p>
                <p className="update-callout__desc">
                  请使用已安装的正式桌面应用。Linux 需要运行 AppImage；开发环境不连接更新源。
                </p>
              </div>
            </div>
          )}

          {state.error && (
            <div className="update-callout" data-tone="danger" role="alert">
              <DialogIcon name="warning" className="update-callout__icon" />
              <div className="update-callout__body">
                <p className="update-callout__title">版本更新未完成</p>
                <p className="update-callout__desc">{state.error.message}</p>
              </div>
            </div>
          )}

          {hasLatest && state.latestVersion ? (
            <section className="update-notes-card">
              <div className="update-notes-card__head">
                <div className="update-notes-card__title">
                  <span>更新说明</span>
                  <span className="update-chip">v{state.latestVersion}</span>
                </div>
                <span className="update-chip">{notesBadgeLabel(state.status)}</span>
              </div>
              <div className="update-notes-card__body">
                <div className="update-notes-card__prose">
                  <ReleaseNotes notes={state.releaseNotes} />
                </div>
              </div>
            </section>
          ) : (
            <section className="update-quiet-card">
              <div className="update-quiet-card__icon" aria-hidden="true">
                <DialogIcon name={state.status === 'not-available' ? 'check' : 'download'} />
              </div>
              <strong>
                {state.status === 'not-available'
                  ? '当前已是最新稳定版本'
                  : '准备就绪，随时检查新版本'}
              </strong>
              <span>
                {state.status === 'not-available'
                  ? `你的 Alune v${state.currentVersion} 与 GitHub Releases 最新稳定版一致。新版本发布后，更新说明会直接展示在这里。`
                  : '点击右上角「检查更新」获取最新稳定版和完整更新说明。下载过程支持后台持续进行。'}
              </span>
            </section>
          )}

          <div className="update-footnote">
            <DialogIcon name="info" className="update-footnote__icon" />
            <span>
              下载完成后，点击“重启安装”将关闭当前 SSH
              连接，安装新版本并重新打开应用。普通退出不会自动安装。
            </span>
          </div>
        </>
      )}
    </div>
  );
}

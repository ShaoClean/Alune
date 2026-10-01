import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, ConfigProvider } from 'antd';
import { useStore } from 'zustand';
import { createFeedbackStore } from '../stores/feedbackStore';
import type { FeedbackEntry } from '../stores/feedbackStore';
import { DialogHints, Kbd } from './AluneModal';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';
import { FeedbackContext } from './feedback-context';

export { FeedbackNotice, FeedbackScope } from './FeedbackNotice';

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createFeedbackStore);
  return (
    <FeedbackContext.Provider value={store}>
      {children}
      <FeedbackCenter store={store} />
    </FeedbackContext.Provider>
  );
}

const TONES = { error: 'danger', warning: 'warning', info: 'info', success: 'success' } as const;
const BUTTONS = { autoInsertSpace: false };

function glyphOf(entry: FeedbackEntry) {
  return (entry.icon ??
    (entry.type === 'success'
      ? 'check'
      : entry.type === 'info'
        ? 'info'
        : 'warning')) as DialogIconName;
}

// Context is 「scope label · detail」; the label heads the eyebrow and the inbox group.
function splitContext(context: string) {
  const [label, ...rest] = context.split(' · ');
  return { label, detail: rest.join(' · ') };
}

function clock(at: number, seconds = true) {
  return new Date(at).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: false,
  });
}

function since(at: number, now: number) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (new Date(at).toDateString() === new Date(now).toDateString()) return clock(at, false);
  return new Date(at).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function FeedbackCenter({ store }: { store: ReturnType<typeof createFeedbackStore> }) {
  const allEntries = useStore(store, (state) => state.entries);
  const entries = allEntries.filter((entry) => !entry.host);
  const [selected, setSelected] = useState<string | null>(null);
  const [inbox, setInbox] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  const [blocked, setBlocked] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [fullscreenLayer, setFullscreenLayer] = useState<Element | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const trayButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const current =
    entries.find((item) => item.id === selected) || entries.find((item) => item.queued);
  const queue = entries.filter((item) => item.queued);
  const open = !blocked && Boolean(current);
  const showTray = entries.length > 0 && !open && !blocked;
  useEffect(() => setCopyStatus(''), [current?.id, current?.revision]);
  useEffect(() => {
    if (!open || !current) return;
    const key = `${current.id}:${current.revision}`;
    setViewed((seen) => (seen.has(key) ? seen : new Set(seen).add(key)));
  }, [open, current?.id, current?.revision]);
  useEffect(() => {
    const check = () => {
      setBlocked(
        Array.from(document.querySelectorAll<HTMLElement>('.ant-modal-wrap')).some(
          (node) => node.getClientRects().length > 0 && getComputedStyle(node).display !== 'none',
        ),
      );
      setFullscreenLayer(document.querySelector('dialog:modal:not(.feedback-dialog)'));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open'],
    });
    check();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const node = dialog.current;
    const trayNode = tray.current;
    let restore = false;
    if (open && node && !node.open) {
      const active = document.activeElement;
      // Opening from the inbox hides the tray, so return to its button instead.
      previousFocus.current =
        active && trayNode?.contains(active)
          ? trayButton.current
          : active instanceof HTMLElement
            ? active
            : null;
      node.showModal();
      node
        .querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')
        ?.focus({ preventScroll: true });
    } else if (!open && node?.open) {
      node.close();
      restore = true;
    }
    // A fresh node after the portal moves (e.g. into a fullscreen Diff) is
    // shown again so it sits above that layer in the top layer.
    if (!showTray) trayNode?.hidePopover();
    else if (trayNode && !trayNode.matches(':popover-open')) trayNode.showPopover();
    if (restore && previousFocus.current?.isConnected)
      previousFocus.current.focus({ preventScroll: true });
  }, [open, showTray, fullscreenLayer]);
  useEffect(() => {
    if (selected && !entries.some((entry) => entry.id === selected)) setSelected(null);
  }, [entries, selected]);
  useEffect(() => {
    if (!showTray) setInbox(false);
  }, [showTray]);
  useEffect(() => {
    if (!inbox) return;
    const dismiss = (event: PointerEvent) => {
      if (!tray.current?.contains(event.target as Node)) setInbox(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [inbox]);
  const close = () => {
    if (current) store.getState().acknowledge(current.id);
    setSelected(null);
  };
  const run = (entry: FeedbackEntry) => {
    if (entry.mode === 'manual') {
      // Configuration actions continue outside the Diff. Release its native
      // inert boundary before opening a form or view.
      if (fullscreenLayer instanceof HTMLDialogElement) fullscreenLayer.close();
      if (entry.id === current?.id) close();
      setInbox(false);
    }
    void store.getState().run(entry.id);
  };
  const openInbox = () => {
    setNow(Date.now());
    setInbox(true);
    requestAnimationFrame(() =>
      tray.current
        ?.querySelector<HTMLButtonElement>('.fb-item-open')
        ?.focus({ preventScroll: true }),
    );
  };
  const closeInbox = () => {
    setInbox(false);
    trayButton.current?.focus({ preventScroll: true });
  };
  const errors = entries.some((entry) => entry.type === 'error');
  const groups = entries.reduce<{ label: string; entries: FeedbackEntry[] }[]>((list, entry) => {
    const { label } = splitContext(entry.context);
    const group = list.find((item) => item.label === label);
    if (group) group.entries.push(entry);
    else list.push({ label, entries: [entry] });
    return list;
  }, []);
  const context = current ? splitContext(current.context) : null;
  const position = current?.queued ? queue.indexOf(current) + 1 : 0;
  const manual = current?.mode === 'manual';
  if (typeof document === 'undefined') return null;
  return (
    <ConfigProvider button={BUTTONS}>
      {createPortal(
        <div
          ref={tray}
          popover="manual"
          className="feedback-tray"
          data-tone={errors ? 'danger' : undefined}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !inbox) return;
            // Keep a fullscreen Diff open underneath.
            event.preventDefault();
            event.stopPropagation();
            closeInbox();
          }}
        >
          <button
            ref={trayButton}
            type="button"
            className="feedback-tray-button"
            aria-expanded={inbox}
            aria-controls="feedback-inbox"
            aria-label={`查看提示（${entries.length} 条）`}
            onClick={() => (inbox ? setInbox(false) : openInbox())}
          >
            <DialogIcon name="bell" />
            <span>提示</span>
            <span className="feedback-tray-dots" aria-hidden="true">
              {entries.slice(0, 5).map((entry) => (
                <i key={entry.id} data-tone={TONES[entry.type]} />
              ))}
            </span>
            <span className="feedback-tray-count">{entries.length}</span>
          </button>
          <div
            id="feedback-inbox"
            className="feedback-inbox a-pop"
            role="dialog"
            aria-label="提示"
            hidden={!inbox}
          >
            <div className="feedback-inbox-core">
              <div className="feedback-inbox-head">
                <strong>提示</strong>
                <span className="dlg-badge is-mono">{entries.length}</span>
              </div>
              <p className="feedback-inbox-lead">按仓库分组；问题解决或重试成功后自动移除。</p>
              <div className="feedback-list">
                {groups.map((group) => (
                  <section key={group.label} className="feedback-group" aria-label={group.label}>
                    <p className="feedback-group-label">{group.label}</p>
                    {group.entries.map((entry) => {
                      const { detail } = splitContext(entry.context);
                      const summary = [detail, entry.description?.split('\n')[0]]
                        .filter(Boolean)
                        .join(' · ');
                      return (
                        <div
                          key={entry.id}
                          className={
                            viewed.has(`${entry.id}:${entry.revision}`)
                              ? 'fb-item'
                              : 'fb-item is-new'
                          }
                          data-tone={TONES[entry.type]}
                        >
                          <span className="fb-glyph" aria-hidden="true">
                            <DialogIcon name={glyphOf(entry)} />
                          </span>
                          <div className="fb-item-main">
                            <button
                              type="button"
                              className="fb-item-open"
                              onClick={() => {
                                setSelected(entry.id);
                                setInbox(false);
                              }}
                            >
                              <span className="fb-item-head">
                                <strong>{entry.title}</strong>
                                <time dateTime={new Date(entry.at).toISOString()}>
                                  {since(entry.at, now)}
                                </time>
                              </span>
                              {summary ? <span className="fb-item-sub">{summary}</span> : null}
                            </button>
                            {entry.actionLabel ? (
                              <div className="fb-item-actions">
                                <Button
                                  size="small"
                                  className="dlg-btn-xs"
                                  loading={entry.busy}
                                  onClick={() => run(entry)}
                                >
                                  {entry.actionLabel}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>,
        fullscreenLayer || document.body,
      )}
      <dialog
        ref={dialog}
        className="feedback-dialog"
        data-tone={current ? TONES[current.type] : undefined}
        aria-labelledby="feedback-title"
        aria-describedby={current?.description ? 'feedback-description' : undefined}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        {current && context ? (
          <div className="feedback-core">
            <header className="feedback-heading">
              <span className="a-dlg-glyph" aria-hidden="true">
                <DialogIcon name={glyphOf(current)} />
              </span>
              <div className="a-dlg-titles">
                <p className="a-dlg-eyebrow">
                  <b>{context.label}</b>
                  {context.detail ? <span>{context.detail}</span> : null}
                </p>
                <h2 id="feedback-title" className="a-dlg-title">
                  {current.title}
                </h2>
              </div>
              <button type="button" className="dlg-icon-btn" aria-label="关闭提示" onClick={close}>
                <DialogIcon name="x" />
              </button>
            </header>
            <div className="feedback-body">
              {current.description && !current.content ? (
                <div
                  className={
                    current.type === 'error'
                      ? 'feedback-description is-mono'
                      : 'feedback-description'
                  }
                  id="feedback-description"
                >
                  {current.description}
                </div>
              ) : null}
              <div className="feedback-context">
                <span className="dlg-badge is-mono">
                  <DialogIcon name="clock" />
                  <time dateTime={new Date(current.at).toISOString()}>{clock(current.at)}</time>
                </span>
              </div>
              {current.content && (
                <div id="feedback-description" className="feedback-description">
                  {current.content}
                </div>
              )}
              {copyStatus && copyStatus !== '已复制' ? (
                <p className="dlg-text is-muted" role="status">
                  {copyStatus}
                </p>
              ) : null}
            </div>
            <footer className="feedback-actions">
              {position && queue.length > 1 ? (
                <DialogHints>
                  <b className="feedback-queue">
                    {position} / {queue.length}
                  </b>
                  · 关闭后显示下一条
                </DialogHints>
              ) : manual && current.actionLabel ? (
                <DialogHints>操作前会先关闭此提示</DialogHints>
              ) : (
                <p className="a-dlg-hints is-kbd">
                  <Kbd>Esc</Kbd> 关闭并标为已读
                </p>
              )}
              <div className="a-dlg-actions">
                {current.actions && (
                  <div
                    className="feedback-custom-actions"
                    onClickCapture={() => store.getState().rearm(current.id)}
                  >
                    {current.actions}
                  </div>
                )}
                {manual ? (
                  <Button type="text" onClick={close}>
                    稍后
                  </Button>
                ) : (
                  <Button
                    icon={<DialogIcon name={copyStatus === '已复制' ? 'check' : 'copy'} />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          [current.context, clock(current.at), current.title, current.description]
                            .filter(Boolean)
                            .join('\n'),
                        );
                        setCopyStatus('已复制');
                      } catch {
                        setCopyStatus('无法复制，请选择提示文本手动复制。');
                      }
                    }}
                  >
                    {copyStatus === '已复制' ? '已复制' : '复制文本'}
                  </Button>
                )}
                {current.actionLabel ? (
                  <Button
                    type="primary"
                    className={current.busy ? 'has-orb is-busy' : 'has-orb'}
                    aria-busy={current.busy || undefined}
                    onClick={() => {
                      if (!current.busy) run(current);
                    }}
                  >
                    <span>{current.actionLabel}</span>
                    <span className="dlg-orb" aria-hidden="true">
                      {current.busy ? (
                        <span className="dlg-moonload" />
                      ) : (
                        <DialogIcon
                          name={
                            (current.actionIcon ??
                              (manual ? 'arrow-right' : 'refresh')) as DialogIconName
                          }
                        />
                      )}
                    </span>
                  </Button>
                ) : (
                  <Button onClick={close}>关闭</Button>
                )}
              </div>
            </footer>
          </div>
        ) : null}
      </dialog>
    </ConfigProvider>
  );
}

export type FeedbackProviderProps = { children: ReactNode };

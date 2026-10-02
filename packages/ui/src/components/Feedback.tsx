import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, ConfigProvider } from 'antd';
import { useStore } from 'zustand';
import { createFeedbackStore } from '../stores/feedbackStore';
import type { FeedbackEntry } from '../stores/feedbackStore';
import { DialogHints, Kbd } from './AluneModal';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';
import { FeedbackContext } from './feedback-context';
import { StatusButton } from './StatusButton';

export { FeedbackNotice, FeedbackScope } from './FeedbackNotice';

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createFeedbackStore);
  return (
    <FeedbackContext.Provider value={store}>
      <FeedbackCenter store={store}>{children}</FeedbackCenter>
    </FeedbackContext.Provider>
  );
}

const TONES = { error: 'danger', warning: 'warning', info: 'info', success: 'success' } as const;
const BUTTONS = { autoInsertSpace: false };

const FeedbackCenterContext = createContext<{
  inbox: boolean;
  entries: FeedbackEntry[];
  viewed: ReadonlySet<string>;
  trigger: RefObject<HTMLButtonElement | null>;
  fullscreenLayer: Element | null;
  toggle: (onUpdates?: () => void) => void;
} | null>(null);

/** The only inbox trigger; in a fullscreen Diff it moves into that view's status bar. */
export function FeedbackStatusButton({ onUpdates }: { onUpdates?: () => void }) {
  const center = useContext(FeedbackCenterContext);
  if (!center) return null;
  const { entries, viewed, trigger, inbox, fullscreenLayer, toggle } = center;
  const unread = entries.filter((entry) => !viewed.has(`${entry.id}:${entry.revision}`)).length;
  const button = (
    <StatusButton
      ref={trigger}
      label={`通知与提示（${entries.length} 条，${unread} 条未读）`}
      tooltip={
        entries.length
          ? `通知与提示 · ${entries.length} 条，${unread} 条未读`
          : '通知与提示 · 暂无通知'
      }
      className="status-button--feedback"
      aria-expanded={inbox}
      aria-controls="feedback-inbox"
      aria-haspopup="dialog"
      onClick={() => toggle(onUpdates)}
    >
      <DialogIcon name="bell" />
      {entries.length > 0 && <span className="status-bar__notice-count">{entries.length}</span>}
      {unread > 0 && <span className="status-bar__notice-dot" aria-hidden="true" />}
    </StatusButton>
  );
  return fullscreenLayer
    ? createPortal(
        <footer className="status-bar feedback-fullscreen-status" aria-label="差异状态栏">
          <span>差异预览</span>
          <div className="status-bar__right">{button}</div>
        </footer>,
        fullscreenLayer,
      )
    : button;
}

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

function FeedbackCenter({
  store,
  children,
}: {
  store: ReturnType<typeof createFeedbackStore>;
  children: ReactNode;
}) {
  const allEntries = useStore(store, (state) => state.entries);
  const entries = allEntries.filter((entry) => !entry.host);
  const [selected, setSelected] = useState<string | null>(null);
  const [inbox, setInbox] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [viewed, setViewed] = useState<ReadonlySet<string>>(() => new Set());
  const [blocked, setBlocked] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [fullscreenLayer, setFullscreenLayer] = useState<Element | null>(null);
  const [updatesAction, setUpdatesAction] = useState<(() => void) | undefined>();
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const inboxTrigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const current =
    entries.find((item) => item.id === selected) || entries.find((item) => item.queued);
  const queue = entries.filter((item) => item.queued);
  const open = !blocked && Boolean(current);
  const showInbox = inbox && !open && !blocked;
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
      setFullscreenLayer(document.querySelector('dialog.diff-shell:modal'));
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
    const panelNode = panel.current;
    let restore = false;
    const active = document.activeElement;
    if (!showInbox) panelNode?.hidePopover();
    if (open && node && !node.open) {
      // Detail hides the inbox; return to the persistent status bar trigger.
      previousFocus.current =
        active && panelNode?.contains(active)
          ? inboxTrigger.current
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
    if (restore && previousFocus.current?.isConnected)
      previousFocus.current.focus({ preventScroll: true });
  }, [open, showInbox, fullscreenLayer]);
  useLayoutEffect(() => {
    const node = panel.current;
    const trigger = inboxTrigger.current;
    if (!showInbox || !node || !trigger) return;
    node.showPopover();
    const position = () => {
      const anchor = trigger.getBoundingClientRect();
      // Layout sizes stay stable while the opening animation transforms the panel.
      const panelWidth = node.offsetWidth;
      const panelHeight = node.offsetHeight;
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      node.style.left = `${Math.max(8, Math.min(anchor.right - panelWidth, width - panelWidth - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(anchor.top - panelHeight - 8, height - panelHeight - 8))}px`;
    };
    position();
    (node.querySelector<HTMLButtonElement>('.fb-item-open') ?? node).focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(node);
    observer.observe(trigger);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      node.hidePopover();
    };
  }, [showInbox, fullscreenLayer]);
  useLayoutEffect(() => {
    // A successful retry can remove the focused row while the inbox remains open.
    if (showInbox && document.activeElement === document.body)
      panel.current?.focus({ preventScroll: true });
  }, [entries, showInbox]);
  useEffect(() => {
    if (selected && !entries.some((entry) => entry.id === selected)) setSelected(null);
  }, [entries, selected]);
  useEffect(() => {
    if (open || blocked) setInbox(false);
  }, [open, blocked]);
  useEffect(() => setInbox(false), [fullscreenLayer]);
  useEffect(() => {
    if (!inbox) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !inboxTrigger.current?.contains(event.target as Node)
      )
        setInbox(false);
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
      store.getState().acknowledge(entry.id);
      setViewed((seen) => new Set(seen).add(`${entry.id}:${entry.revision}`));
      setInbox(false);
    }
    void store.getState().run(entry.id);
  };
  const openInbox = (onUpdates?: () => void) => {
    setNow(Date.now());
    setUpdatesAction(() => onUpdates);
    setInbox(true);
  };
  const closeInbox = () => {
    setInbox(false);
    inboxTrigger.current?.focus({ preventScroll: true });
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
  if (typeof document === 'undefined') return children;
  return (
    <FeedbackCenterContext.Provider
      value={{
        inbox: showInbox,
        entries,
        viewed,
        trigger: inboxTrigger,
        fullscreenLayer,
        toggle: (onUpdates) => (inbox ? closeInbox() : openInbox(onUpdates)),
      }}
    >
      {children}
      <ConfigProvider button={BUTTONS}>
        {createPortal(
          <div
            ref={panel}
            popover="manual"
            id="feedback-inbox"
            className="feedback-inbox a-pop"
            role="dialog"
            aria-label="通知与提示"
            tabIndex={-1}
            data-tone={errors ? 'danger' : undefined}
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                !event.currentTarget.contains(event.relatedTarget as Node) &&
                !inboxTrigger.current?.contains(event.relatedTarget as Node)
              )
                setInbox(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !inbox) return;
              // Keep a fullscreen Diff open underneath.
              event.preventDefault();
              event.stopPropagation();
              closeInbox();
            }}
          >
            <div className="feedback-inbox-core">
              <div className="feedback-inbox-head">
                <strong>通知与提示</strong>
                <span className="dlg-badge is-mono">{entries.length}</span>
                <button
                  type="button"
                  className="dlg-icon-btn"
                  aria-label="关闭通知与提示"
                  onClick={closeInbox}
                >
                  <DialogIcon name="x" />
                </button>
              </div>
              <p className="feedback-inbox-lead">按来源分组；问题解决或重试成功后自动移除。</p>
              <div className="feedback-list">
                {!entries.length && <p className="feedback-inbox-empty">暂无通知与提示</p>}
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
              {updatesAction && !entries.some((entry) => entry.actionLabel === '查看更新') && (
                <button
                  type="button"
                  className="text-button feedback-inbox-more"
                  onClick={() => {
                    if (fullscreenLayer instanceof HTMLDialogElement) fullscreenLayer.close();
                    setInbox(false);
                    updatesAction();
                  }}
                >
                  检查更新
                </button>
              )}
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
                <button
                  type="button"
                  className="dlg-icon-btn"
                  aria-label="关闭提示"
                  onClick={close}
                >
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
    </FeedbackCenterContext.Provider>
  );
}

export type FeedbackProviderProps = { children: ReactNode };

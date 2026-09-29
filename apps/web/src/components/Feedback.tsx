import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { App, Button } from 'antd';
import { BellOutlined, CloseOutlined, CopyOutlined } from '@ant-design/icons';
import { useStore } from 'zustand';
import { createFeedbackStore } from '../stores/feedbackStore';
import type { FeedbackEvent } from '../stores/feedbackStore';

const FeedbackContext = createContext<ReturnType<typeof createFeedbackStore> | null>(null);
const ScopeContext = createContext({ id: 'application', label: 'Alune', active: true });
const objectKeys = new WeakMap<object, number>();
let nextKey = 0;
function revisionKey(value: string | number | object) {
  if (typeof value !== 'object') return String(value);
  if (!objectKeys.has(value)) objectKeys.set(value, ++nextKey);
  return String(objectKeys.get(value));
}

export function FeedbackScope({
  id,
  label,
  active = true,
  children,
}: {
  id: string;
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return <ScopeContext.Provider value={{ id, label, active }}>{children}</ScopeContext.Provider>;
}

export function FeedbackNotice({
  source,
  title,
  description,
  type = 'error',
  mode = 'modal',
  eventKey,
  context,
  actionLabel,
  onAction,
  busy,
  resetOnClear = true,
}: {
  source: string;
  title?: string | null;
  description?: string;
  type?: FeedbackEvent['type'];
  mode?: FeedbackEvent['mode'];
  eventKey?: string | number | object;
  context?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  busy?: boolean;
  resetOnClear?: boolean;
}) {
  const store = useContext(FeedbackContext);
  const scope = useContext(ScopeContext);
  const { message } = App.useApp();
  const callback = useRef(onAction);
  callback.current = onAction;
  const id = JSON.stringify([scope.id, source, context]);
  const revision =
    eventKey === undefined ? JSON.stringify([title, description, type]) : revisionKey(eventKey);
  const success = useRef('');
  useEffect(() => {
    if (!store || !scope.active) return;
    if (!title) {
      if (resetOnClear) store.getState().rearm(id);
      if (!busy) store.getState().settle(id);
      success.current = '';
      return;
    }
    if (type === 'success') {
      if (success.current !== revision) void message.success(title);
      success.current = revision;
      return;
    }
    const owner = store.getState().publish({
      id,
      scope: scope.id,
      context: [scope.label, context].filter(Boolean).join(' · '),
      title,
      description,
      type,
      mode,
      revision,
      actionLabel,
      busy,
      onAction: actionLabel ? () => callback.current?.() : undefined,
    });
    // React StrictMode replays effects; let a new lease replace the old one first.
    return () => {
      queueMicrotask(() => store.getState().release(id, owner));
    };
  }, [
    store,
    scope.id,
    scope.label,
    scope.active,
    id,
    title,
    description,
    type,
    mode,
    revision,
    actionLabel,
    busy,
    resetOnClear,
    message,
  ]);
  return null;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createFeedbackStore);
  return (
    <FeedbackContext.Provider value={store}>
      {children}
      <FeedbackCenter store={store} />
    </FeedbackContext.Provider>
  );
}

function FeedbackCenter({ store }: { store: ReturnType<typeof createFeedbackStore> }) {
  const entries = useStore(store, (state) => state.entries);
  const [selected, setSelected] = useState<string | null>(null);
  const [inbox, setInbox] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [fullscreenLayer, setFullscreenLayer] = useState<Element | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const current =
    entries.find((item) => item.id === selected) ||
    (!inbox ? entries.find((item) => item.queued) : undefined);
  useEffect(() => setCopyStatus(''), [current?.id, current?.revision]);
  const open = !blocked && Boolean(inbox || current);
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
    if (!node) return;
    if (open && !node.open) {
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
      node
        .querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')
        ?.focus({ preventScroll: true });
    } else if (!open && node.open) {
      node.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    }
  }, [open]);
  useLayoutEffect(() => {
    const node = tray.current;
    // Reinsert the entry above a newly opened fullscreen Diff in the top layer.
    node?.hidePopover();
    if (entries.length && !open && !blocked) node?.showPopover();
  }, [entries.length, open, blocked, fullscreenLayer]);
  useEffect(() => {
    if (selected && !entries.some((entry) => entry.id === selected)) setSelected(null);
  }, [entries, selected]);
  const close = () => {
    if (current) store.getState().acknowledge(current.id);
    setSelected(null);
    setInbox(false);
  };
  return (
    <>
      {createPortal(
        <div ref={tray} popover="manual" className="feedback-tray">
          <Button
            icon={<BellOutlined />}
            onClick={() => setInbox(true)}
            aria-label={`查看提示（${entries.length} 条）`}
          >
            提示 · {entries.length}
          </Button>
        </div>,
        fullscreenLayer || document.body,
      )}
      <dialog
        ref={dialog}
        className="feedback-dialog"
        aria-labelledby="feedback-title"
        aria-describedby={current ? 'feedback-description' : undefined}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header className="feedback-heading">
          <h2 id="feedback-title">{current?.title || '通知与仓库说明'}</h2>
          <Button type="text" icon={<CloseOutlined />} aria-label="关闭提示" onClick={close} />
        </header>
        {current ? (
          <>
            <p className="feedback-context">{current.context}</p>
            <div
              className={`feedback-description feedback-description--${current.type}`}
              id="feedback-description"
            >
              {current.description || current.title}
            </div>
            {copyStatus && copyStatus !== '已复制' && <p role="status">{copyStatus}</p>}
            <footer className="feedback-actions">
              <Button
                icon={<CopyOutlined />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      [current.context, current.title, current.description]
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
              <Button onClick={close}>关闭</Button>
              {current.actionLabel && (
                <Button
                  type="primary"
                  loading={current.busy}
                  onClick={() => {
                    if (current.mode === 'manual') {
                      // Configuration actions continue outside the Diff. Release
                      // its native inert boundary before opening a form or view.
                      if (fullscreenLayer instanceof HTMLDialogElement) fullscreenLayer.close();
                      close();
                    }
                    void store.getState().run(current.id);
                  }}
                >
                  {current.actionLabel}
                </Button>
              )}
            </footer>
          </>
        ) : (
          <div className="feedback-list">
            {entries.length ? (
              entries.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => {
                    setSelected(entry.id);
                    setInbox(false);
                  }}
                >
                  <strong>{entry.title}</strong>
                  <span>{entry.context}</span>
                </button>
              ))
            ) : (
              <p>暂无提示</p>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}

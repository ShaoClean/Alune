import { useStore } from 'zustand';
import { FeedbackContext, FeedbackHostContext, emptyFeedbackStore } from './feedback-context';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Button, ConfigProvider, Input, Modal } from 'antd';
import type { ModalProps } from 'antd';
import { Provider as MotionProvider } from '@rc-component/motion';
import { useUIAppearance } from '../appearance';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';

/**
 * Risk level from the dialog spec:
 * 0 reversible (blue primary, ↵ submits), 1 has a cost (soft red, primary focused),
 * 2 irreversible (solid red, Cancel focused, ↵ disabled, explicit acknowledgement).
 */
export type DialogLevel = 0 | 1 | 2;
export type DialogTone = 'default' | 'info' | 'success' | 'warning' | 'danger';
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const WIDTHS: Record<DialogSize, number> = { sm: 400, md: 520, lg: 680, xl: 880 };
// The outer tray adds 6px on each side around the core panel.
const SHELL_PADDING = 12;

export interface DialogEyebrow {
  label: ReactNode;
  detail?: ReactNode;
}

export interface AluneModalProps extends Omit<
  ModalProps,
  'title' | 'footer' | 'onOk' | 'onCancel' | 'width' | 'okType' | 'modalRender'
> {
  level?: DialogLevel;
  tone?: DialogTone;
  size?: DialogSize | number;
  glyph?: DialogIconName | ReactNode | false;
  eyebrow?: DialogEyebrow;
  /** Level chip after the eyebrow; L2 shows 「不可撤销」 unless set to false. */
  levelLabel?: ReactNode | false;
  title: ReactNode;
  description?: ReactNode;
  /** Footer hints; defaults to the keyboard contract of the level. Hidden below 768px. */
  hints?: ReactNode | false;
  /** Verb after ↵ in the default hints, e.g. 「创建」. */
  hintVerb?: ReactNode;
  danger?: boolean;
  okIcon?: DialogIconName | false;
  okDisabled?: boolean;
  busyText?: ReactNode;
  hideCancel?: boolean;
  /** Replaces the action row; `null` removes the footer entirely. */
  footer?: ReactNode | null;
  /** Extra actions rendered before Cancel. */
  extra?: ReactNode;
  /** Required acknowledgement; the primary action stays disabled until it is checked. */
  acknowledge?: ReactNode;
  /** Required typed confirmation, e.g. the branch name for a force push. */
  typedConfirm?: {
    value: string;
    label?: ReactNode;
    placeholder?: string;
    icon?: DialogIconName;
    /** Feedback once the input matches or diverges, e.g. 「与当前分支名不一致」. */
    mismatch?: ReactNode;
    match?: ReactNode;
  };
  body?: 'default' | 'flush' | 'tight' | 'scroll';
  initialFocus?: 'ok' | 'cancel' | 'field';
  onOk?: () => unknown;
  onCancel?: () => void;
}

// Board labels read 「取消」, not antd's spaced 「取 消」, for every button inside a dialog.
const DIALOG_BUTTON_CONFIG = { autoInsertSpace: false };

const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'email',
  'password',
  'number',
  'tel',
]);

function submitsOnEnter(event: KeyboardEvent, dialog: HTMLElement) {
  if (
    event.key !== 'Enter' ||
    event.isComposing ||
    event.shiftKey ||
    event.altKey ||
    event.metaKey ||
    event.ctrlKey
  ) {
    return false;
  }
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target === dialog) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  if (!TEXT_INPUT_TYPES.has(target.type)) return false;
  return !target.closest('.ant-select, .ant-picker, .ant-cascader, [data-enter="ignore"]');
}

function focusable(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(element && element.isConnected && !(element as HTMLButtonElement).disabled);
}

export function DialogHints({ tone, children }: { tone?: 'warn'; children: ReactNode }) {
  return <p className={tone === 'warn' ? 'a-dlg-hints is-warn' : 'a-dlg-hints'}>{children}</p>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="dlg-kbd">{children}</kbd>;
}

function defaultHints(level: DialogLevel, verb: ReactNode, cancel: boolean) {
  if (level === 2) {
    return (
      <DialogHints tone="warn">
        <span>
          <DialogIcon name="warning" />
          不可撤销
        </span>
        <i />
        <span>
          <Kbd>↵</Kbd> 已停用
        </span>
      </DialogHints>
    );
  }
  return (
    <DialogHints>
      <span>
        <Kbd>↵</Kbd> {verb}
      </span>
      {cancel ? (
        <>
          <i />
          <span>
            <Kbd>Esc</Kbd> 取消
          </span>
        </>
      ) : null}
    </DialogHints>
  );
}

export function CheckCard({
  checked,
  onChange,
  title,
  description,
  tone,
  plain,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'danger';
  plain?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={['dlg-check', plain ? 'is-plain' : '', className ?? ''].filter(Boolean).join(' ')}
      data-tone={tone}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
      />
      <span className="dlg-check-box" aria-hidden="true">
        <DialogIcon name="check" />
      </span>
      <span className="dlg-check-text">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}

/**
 * Moonlight dialog: Ant Design `Modal` inside the two-layer shell, with the
 * L0/L1/L2 button, focus and keyboard contract from the dialog spec.
 */
export function AluneModal({
  level = 0,
  tone,
  size = 'md',
  glyph,
  eyebrow,
  levelLabel,
  title,
  description,
  hints,
  hintVerb,
  danger,
  okIcon = 'arrow-right',
  okDisabled,
  busyText,
  hideCancel,
  footer,
  extra,
  acknowledge,
  typedConfirm,
  body = 'default',
  initialFocus,
  okText,
  cancelText = '取消',
  okButtonProps,
  cancelButtonProps,
  confirmLoading,
  onOk,
  onCancel,
  open,
  children,
  classNames,
  afterOpenChange,
  ...rest
}: AluneModalProps) {
  const feedbackStore = useContext(FeedbackContext) ?? emptyFeedbackStore;
  const hostId = useId();
  const feedbackHost = useMemo(() => ({ id: hostId, active: Boolean(open) }), [hostId, open]);
  const feedback = useStore(feedbackStore, (state) =>
    state.entries.find((entry) => entry.host === hostId && entry.queued),
  );
  const dismissFeedback = () => {
    if (feedback) feedbackStore.getState().acknowledge(feedback.id);
  };
  useEffect(() => {
    if (open) return;
    for (const entry of feedbackStore.getState().entries) {
      if (entry.host === hostId) feedbackStore.getState().release(entry.id, entry.lease);
    }
  }, [open, feedbackStore, hostId]);
  useEffect(
    () => () => {
      queueMicrotask(() => {
        if (document.querySelector(`[data-feedback-host="${CSS.escape(hostId)}"]`)) return;
        for (const entry of feedbackStore.getState().entries) {
          if (entry.host === hostId) feedbackStore.getState().release(entry.id, entry.lease);
        }
      });
    },
    [feedbackStore, hostId],
  );
  const feedbackRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (feedback) {
      if (!returnFocus.current && document.activeElement instanceof HTMLElement)
        returnFocus.current = document.activeElement;
      feedbackRef.current?.focus({ preventScroll: true });
    } else if (returnFocus.current) {
      if (returnFocus.current.isConnected) returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [feedback?.id]);
  const reduceMotion = useUIAppearance().reduceMotion;
  const titleId = useId();
  const descriptionId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const settleInitialFocus = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) return;
    setAcknowledged(false);
    setTyped('');
  }, [open]);
  // A re-read that withdraws the acknowledgement must also clear it.
  const asksAcknowledgement = acknowledge !== undefined;
  useEffect(() => {
    if (!asksAcknowledgement) setAcknowledged(false);
  }, [asksAcknowledgement]);

  const isDanger = danger ?? level === 2;
  const mergedTone = feedback
    ? feedback.type === 'error'
      ? 'danger'
      : feedback.type
    : (tone ?? (isDanger ? 'danger' : 'default'));
  const {
    loading: okLoading,
    disabled: okPropDisabled,
    className: okClassName,
    ...okRest
  } = okButtonProps ?? {};
  const busy = Boolean(confirmLoading || pending || okLoading);
  const typedValue = typed.trim();
  const typedMatch = typedConfirm !== undefined && typedValue === typedConfirm.value;
  const typedMismatch = typedConfirm !== undefined && typedValue !== '' && !typedMatch;
  const gated =
    (acknowledge !== undefined && !acknowledged) || (typedConfirm !== undefined && !typedMatch);
  const okBlocked = Boolean(okDisabled || okPropDisabled || gated);

  const pendingRef = useRef(false);
  const submit = useCallback(() => {
    if (!onOk || pendingRef.current) return;
    pendingRef.current = true;
    let result: unknown;
    try {
      result = onOk();
    } catch (error) {
      pendingRef.current = false;
      throw error;
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setPending(true);
      const settled = () => {
        pendingRef.current = false;
        setPending(false);
      };
      (result as Promise<unknown>).then(settled, settled);
    } else pendingRef.current = false;
  }, [onOk]);

  const latest = useRef({ level, busy, okBlocked: okBlocked || !!feedback, submit });
  latest.current = { level, busy, okBlocked: okBlocked || !!feedback, submit };

  // rc-dialog focuses the dialog element after its motion ends unless focus is
  // already inside, so the level's default focus is applied as soon as the
  // content mounts and retried until it sticks.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let tries = 0;
    let dialog: HTMLElement | null = null;
    let interacted = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.isTrusted) interacted = true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isTrusted) interacted = true;
      const state = latest.current;
      if (!dialog || state.level === 2 || state.busy || state.okBlocked) return;
      if (!submitsOnEnter(event, dialog)) return;
      event.preventDefault();
      state.submit();
    };
    const pickTarget = () => {
      const ok = okRef.current;
      const cancel = cancelRef.current;
      const body = shellRef.current?.querySelector<HTMLElement>('.ant-modal-body');
      const field =
        body?.querySelector<HTMLElement>('[data-autofocus]') ??
        body?.querySelector<HTMLElement>(
          ':is(input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, [role=radio][tabindex="0"], [role=radio]:not([tabindex]))',
        );
      const mode = initialFocus ?? (level === 2 ? 'cancel' : level === 1 ? 'ok' : 'field');
      if (mode === 'cancel') return focusable(cancel) ? cancel : ok;
      if (mode === 'field' && focusable(field)) return field;
      if (focusable(ok) && !latest.current.okBlocked) return ok;
      return focusable(cancel) ? cancel : ok;
    };
    let moved = false;
    const run = () => {
      if (interacted) return;
      const shell = shellRef.current;
      dialog = shell?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
      if (!shell || !dialog) {
        if (tries++ < 30) frame = requestAnimationFrame(run);
        return;
      }
      if (!moved) {
        dialog.setAttribute('aria-labelledby', titleId);
        if (description) dialog.setAttribute('aria-describedby', descriptionId);
        dialog.setAttribute('role', level === 2 ? 'alertdialog' : 'dialog');
        dialog.addEventListener('keydown', onKeyDown);
        dialog.addEventListener('pointerdown', onPointerDown);
      }
      const target = pickTarget();
      const active = document.activeElement;
      const free = active === dialog || !dialog.contains(active);
      // Ant Design may initially focus its close button; apply every level's
      // contract once, then leave subsequent user focus changes alone.
      if (target && (free || !moved)) target.focus();
      // A reopened, retained dialog can still be hidden for this frame. The
      // focus trap may then select its close button. Only finish initialization
      // once our target actually receives focus, including that retry case.
      moved = Boolean(target && document.activeElement === target);
      if (!moved && tries++ < 30) {
        frame = requestAnimationFrame(run);
      }
    };
    // The focus trap can initialize after our first animation frame. Reconcile
    // its default close-button focus when entrance finishes, unless the user
    // has already started interacting with the dialog.
    settleInitialFocus.current = () => {
      if (interacted) return;
      cancelAnimationFrame(frame);
      moved = false;
      run();
    };
    frame = requestAnimationFrame(run);
    return () => {
      settleInitialFocus.current = null;
      cancelAnimationFrame(frame);
      dialog?.removeEventListener('keydown', onKeyDown);
      dialog?.removeEventListener('pointerdown', onPointerDown);
    };
    // Focus is chosen once per opening; later prop changes must not steal it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const dialog = shellRef.current?.closest('[role="dialog"], [role="alertdialog"]');
    if (feedback || description) dialog?.setAttribute('aria-describedby', descriptionId);
    else dialog?.removeAttribute('aria-describedby');
  }, [feedback?.id, description, descriptionId]);

  const width = typeof size === 'number' ? size + SHELL_PADDING : WIDTHS[size] + SHELL_PADDING;
  const showLevel = levelLabel !== false && (levelLabel !== undefined || level === 2);
  const heading = (
    <div
      className={
        glyph === false || glyph === undefined ? 'a-dlg-heading is-plain' : 'a-dlg-heading'
      }
    >
      {glyph === false || glyph === undefined ? null : (
        <span className="a-dlg-glyph" aria-hidden="true">
          {typeof glyph === 'string' ? <DialogIcon name={glyph as DialogIconName} /> : glyph}
        </span>
      )}
      <div className="a-dlg-titles">
        {eyebrow || showLevel ? (
          <p className="a-dlg-eyebrow">
            {eyebrow ? <b>{eyebrow.label}</b> : null}
            {eyebrow?.detail ? <span>{eyebrow.detail}</span> : null}
            {showLevel ? (
              <span className="lvl">
                L{level}
                {level === 2 && levelLabel === undefined ? (
                  ' · 不可撤销'
                ) : levelLabel ? (
                  <> · {levelLabel}</>
                ) : null}
              </span>
            ) : null}
          </p>
        ) : null}
        <h2 className="a-dlg-title" id={titleId}>
          {title}
        </h2>
        {description ? (
          <p className="a-dlg-desc" id={descriptionId}>
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );

  const okLabel = busy && busyText ? busyText : okText;
  const withOrb = okIcon !== false && !(isDanger && level < 2);
  const okButton = (
    <Button
      {...okRest}
      ref={okRef}
      type={isDanger && level < 2 ? 'default' : 'primary'}
      danger={isDanger}
      disabled={okBlocked}
      aria-busy={busy || undefined}
      className={
        [withOrb ? 'has-orb' : '', busy ? 'is-busy' : '', okClassName ?? '']
          .filter(Boolean)
          .join(' ') || undefined
      }
      onClick={() => {
        if (!busy) submit();
      }}
    >
      {busy && !withOrb ? <span className="dlg-moonload" aria-hidden="true" /> : null}
      <span>{okLabel}</span>
      {withOrb ? (
        <span className="dlg-orb" aria-hidden="true">
          {busy ? (
            <span className="dlg-moonload" />
          ) : (
            <DialogIcon name={okIcon as DialogIconName} />
          )}
        </span>
      ) : null}
    </Button>
  );
  const cancelButton = hideCancel ? null : (
    <Button
      {...cancelButtonProps}
      ref={cancelRef}
      disabled={busy || cancelButtonProps?.disabled}
      onClick={onCancel}
    >
      {cancelText}
    </Button>
  );
  const footerHints =
    hints === false ? null : (hints ?? defaultHints(level, hintVerb ?? '确认', !hideCancel));
  const footerNode =
    footer === null ? null : (
      <>
        {footerHints}
        <div className="a-dlg-actions">
          {footer === undefined ? (
            <>
              {extra}
              {cancelButton}
              {okButton}
            </>
          ) : (
            footer
          )}
        </div>
      </>
    );

  const semanticClassNames = typeof classNames === 'object' ? classNames : {};
  const bodyClass = ['a-dlg-body', body === 'default' ? '' : `is-${body}`, semanticClassNames.body]
    .filter(Boolean)
    .join(' ');

  return (
    <FeedbackHostContext.Provider value={feedbackHost}>
      <ConfigProvider button={DIALOG_BUTTON_CONFIG}>
        <MotionProvider motion>
          <Modal
            {...rest}
            open={open}
            afterOpenChange={(visible) => {
              if (visible) settleInitialFocus.current?.();
              afterOpenChange?.(visible);
            }}
            centered
            width={width}
            title={
              feedback ? (
                <div className="a-dlg-heading">
                  <span className="a-dlg-glyph" aria-hidden="true">
                    <DialogIcon
                      name={
                        feedback.type === 'success'
                          ? 'check'
                          : feedback.type === 'info'
                            ? 'info'
                            : 'warning'
                      }
                    />
                  </span>
                  <div className="a-dlg-titles">
                    <p className="a-dlg-eyebrow">{feedback.context}</p>
                    <h2 className="a-dlg-title" id={titleId}>
                      {feedback.title}
                    </h2>
                  </div>
                </div>
              ) : (
                heading
              )
            }
            footer={
              feedback ? (
                <div className="a-dlg-actions">
                  {feedback.actions && (
                    <div onClickCapture={() => feedbackStore.getState().rearm(feedback.id)}>
                      {feedback.actions}
                    </div>
                  )}
                  {feedback.actionLabel && (
                    <Button
                      loading={feedback.busy}
                      onClick={() => void feedbackStore.getState().run(feedback.id)}
                    >
                      {feedback.actionLabel}
                    </Button>
                  )}
                  <Button ref={feedbackRef} onClick={dismissFeedback}>
                    返回
                  </Button>
                </div>
              ) : (
                footerNode
              )
            }
            onCancel={() => {
              if (feedback) dismissFeedback();
              else if (!busy) onCancel?.();
            }}
            confirmLoading={busy}
            mask={{ blur: true }}
            closable={{
              closeIcon: <DialogIcon name="x" />,
              disabled: !feedback && busy,
              'aria-label': feedback ? '关闭提示' : '关闭',
            }}
            transitionName="alune-dlg"
            maskTransitionName="alune-scrim"
            classNames={{
              ...semanticClassNames,
              root: ['a-dlg', semanticClassNames.root].filter(Boolean).join(' '),
              mask: ['a-dlg-scrim', semanticClassNames.mask].filter(Boolean).join(' '),
              container: ['a-dlg-core', semanticClassNames.container].filter(Boolean).join(' '),
              header: ['a-dlg-head', semanticClassNames.header].filter(Boolean).join(' '),
              body: bodyClass,
              footer: ['a-dlg-foot', semanticClassNames.footer].filter(Boolean).join(' '),
            }}
            modalRender={(node) => (
              <MotionProvider motion={!reduceMotion}>
                <div
                  ref={shellRef}
                  data-feedback-host={open ? hostId : undefined}
                  className="a-dlg-shell"
                  data-tone={mergedTone === 'default' ? undefined : mergedTone}
                  data-level={level}
                >
                  {node}
                </div>
              </MotionProvider>
            )}
          >
            {feedback && (
              <div className="feedback-description" id={descriptionId} role="status">
                {feedback.content || feedback.description}
              </div>
            )}
            <div className="a-dlg-form-content" hidden={!!feedback}>
              {children}
              {typedConfirm ? (
                <label className="dlg-fld">
                  <span className="dlg-fld-label">
                    <span>
                      {typedConfirm.label ?? (
                        <>
                          输入 <code>{typedConfirm.value}</code> 以确认
                        </>
                      )}
                    </span>
                    <small>区分大小写</small>
                  </span>
                  <Input
                    className="dlg-mono-input"
                    value={typed}
                    placeholder={typedConfirm.placeholder ?? typedConfirm.value}
                    prefix={typedConfirm.icon ? <DialogIcon name={typedConfirm.icon} /> : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                    // Only a diverging prefix turns the ring red, so typing in progress stays calm.
                    status={
                      typedMismatch && !typedConfirm.value.startsWith(typedValue)
                        ? 'error'
                        : undefined
                    }
                    aria-invalid={typedMismatch || undefined}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                  {typedMismatch ? (
                    <span className="dlg-fld-hint is-error" role="status">
                      <DialogIcon name="warning" />
                      {typedConfirm.mismatch ?? '输入内容不一致'}
                    </span>
                  ) : typedMatch ? (
                    <span className="dlg-fld-hint is-ok" role="status">
                      <DialogIcon name="check" />
                      {typedConfirm.match ?? '输入一致'}
                    </span>
                  ) : null}
                </label>
              ) : null}
              {acknowledge !== undefined ? (
                <CheckCard
                  tone="danger"
                  checked={acknowledged}
                  disabled={busy}
                  onChange={setAcknowledged}
                  title={acknowledge}
                />
              ) : null}
            </div>
          </Modal>
        </MotionProvider>
      </ConfigProvider>
    </FeedbackHostContext.Provider>
  );
}

/* -------------------------------------------------------------------------
   useAluneConfirm: imperative confirmations rendered with AluneModal
   ------------------------------------------------------------------------- */

export interface AluneConfirmOptions extends Omit<
  AluneModalProps,
  'open' | 'children' | 'onOk' | 'onCancel' | 'afterClose'
> {
  content?: ReactNode;
  /** May return a promise: the dialog stays busy until it settles and stays open if it rejects. */
  onOk?: () => unknown;
  onCancel?: () => void;
}

export interface AluneConfirmApi {
  confirm: (options: AluneConfirmOptions) => Promise<boolean>;
}

export const AluneConfirmContext = createContext<AluneConfirmApi | null>(null);

/** Lets stateful confirm content gate the primary action, e.g. an empty required field. */
export const AluneConfirmControl = createContext<{
  setOkDisabled: (disabled: boolean) => void;
} | null>(null);

interface ConfirmEntry {
  id: number;
  options: AluneConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

function ConfirmHost({ entry, onDone }: { entry: ConfirmEntry; onDone: (id: number) => void }) {
  const [open, setOpen] = useState(true);
  const [okLocked, setOkLocked] = useState(false);
  const control = useMemo(() => ({ setOkDisabled: setOkLocked }), []);
  const settled = useRef(false);
  const { content, onOk, onCancel, okDisabled, ...options } = entry.options;
  const finish = (confirmed: boolean) => {
    if (settled.current) return;
    settled.current = true;
    entry.resolve(confirmed);
    setOpen(false);
  };
  return (
    <AluneModal
      {...options}
      open={open}
      okDisabled={okDisabled || okLocked}
      afterClose={() => onDone(entry.id)}
      onOk={() => {
        const result = onOk?.();
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).then(() => finish(true));
        }
        finish(true);
        return undefined;
      }}
      onCancel={() => {
        onCancel?.();
        finish(false);
      }}
    >
      <AluneConfirmControl.Provider value={control}>
        {typeof content === 'string' ? <p className="dlg-text">{content}</p> : content}
      </AluneConfirmControl.Provider>
    </AluneModal>
  );
}

export function AluneConfirmProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ConfirmEntry[]>([]);
  const sequence = useRef(0);
  const confirm = useCallback(
    (options: AluneConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        sequence.current += 1;
        const id = sequence.current;
        setEntries((current) => [...current, { id, options, resolve }]);
      }),
    [],
  );
  const remove = useCallback(
    (id: number) => setEntries((current) => current.filter((entry) => entry.id !== id)),
    [],
  );
  const api = useMemo(() => ({ confirm }), [confirm]);
  return (
    <AluneConfirmContext.Provider value={api}>
      {children}
      {entries.map((entry) => (
        <ConfirmHost key={entry.id} entry={entry} onDone={remove} />
      ))}
    </AluneConfirmContext.Provider>
  );
}

export function useAluneConfirm() {
  const api = useContext(AluneConfirmContext);
  if (!api) throw new Error('useAluneConfirm must be used inside AluneConfirmProvider');
  return api.confirm;
}

export type DialogHintsProps = { tone?: 'warn'; children: ReactNode };

export type KbdProps = { children: ReactNode };

export type CheckCardProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'danger';
  plain?: boolean;
  disabled?: boolean;
  className?: string;
};

export type AluneConfirmProviderProps = { children: ReactNode };

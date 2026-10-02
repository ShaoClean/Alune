import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { FeedbackContext, FeedbackHostContext } from './feedback-context';
import type { FeedbackEvent } from '../stores/feedbackStore';
import type { DialogIconName } from './DialogIcons';
export const ScopeContext = createContext({ id: 'application', label: 'Alune', active: true });
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
  const parent = useContext(ScopeContext);
  const value = useMemo(
    () => ({ id, label, active: active && parent.active }),
    [id, label, active, parent.active],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function FeedbackNotice({
  source,
  title,
  description,
  type = 'error',
  mode = 'modal',
  autoOpen,
  eventKey,
  context,
  actionLabel,
  onAction,
  busy,
  icon,
  actionIcon,
  resetOnClear = mode === 'modal',
  content,
  actions,
}: {
  source: string;
  content?: ReactNode;
  actions?: ReactNode;
  title?: string | null;
  description?: string;
  type?: FeedbackEvent['type'];
  mode?: FeedbackEvent['mode'];
  autoOpen?: boolean;
  eventKey?: string | number | object;
  context?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  busy?: boolean;
  /** Glyph for the notice; defaults to the icon for its type. */
  icon?: DialogIconName;
  /** Icon in the primary action's orb. */
  actionIcon?: DialogIconName;
  resetOnClear?: boolean;
}) {
  const store = useContext(FeedbackContext);
  const scope = useContext(ScopeContext);
  const host = useContext(FeedbackHostContext);
  const callback = useRef(onAction);
  callback.current = onAction;
  const presentation = useRef({ content, actions });
  presentation.current = { content, actions };
  const id = JSON.stringify([scope.id, source, context]);
  const revision =
    eventKey === undefined ? JSON.stringify([title, description, type]) : revisionKey(eventKey);
  useEffect(() => {
    if (!store || !scope.active || (host && !host.active)) return;
    if (!title) {
      if (resetOnClear) store.getState().rearm(id);
      return;
    }
    const owner = store.getState().publish({
      id,
      scope: scope.id,
      host: host?.id,
      content: presentation.current.content,
      actions: presentation.current.actions,
      context: [scope.label, context].filter(Boolean).join(' · '),
      title,
      description,
      type,
      mode,
      autoOpen,
      revision,
      actionLabel,
      busy,
      icon,
      actionIcon,
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
    autoOpen,
    revision,
    actionLabel,
    busy,
    icon,
    actionIcon,
    resetOnClear,
    host?.id,
    host?.active,
  ]);
  useEffect(() => {
    if (!store || !title) return;
    store.getState().updatePresentation(id, content, actions);
  }, [store, id, title, content, actions]);
  return null;
}

export type FeedbackScopeProps = {
  id: string;
  label: string;
  active?: boolean;
  children: ReactNode;
};

export type FeedbackNoticeProps = {
  source: string;
  content?: ReactNode;
  actions?: ReactNode;
  title?: string | null;
  description?: string;
  type?: FeedbackEvent['type'];
  mode?: FeedbackEvent['mode'];
  autoOpen?: boolean;
  eventKey?: string | number | object;
  context?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  busy?: boolean;
  /** Glyph for the notice; defaults to the icon for its type. */
  icon?: DialogIconName;
  /** Icon in the primary action's orb. */
  actionIcon?: DialogIconName;
  resetOnClear?: boolean;
};

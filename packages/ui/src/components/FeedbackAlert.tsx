import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';
import { FeedbackNotice } from './FeedbackNotice';
import type { FeedbackEvent } from '../stores/feedbackStore';

/** Stable text identity for rich explanations; never serialize React internals. */
export function feedbackText(value: ReactNode): string {
  return Children.toArray(value)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      return isValidElement<{ children?: ReactNode }>(child)
        ? feedbackText(child.props.children)
        : '';
    })
    .join('');
}

/** Layout-free migration entry for rich notices and their existing controls. */
export function FeedbackAlert({
  source,
  title,
  message,
  description,
  type = 'info',
  action,
  context,
  eventKey,
}: {
  source: string;
  title?: ReactNode;
  message?: ReactNode;
  description?: ReactNode;
  type?: FeedbackEvent['type'];
  action?: ReactNode;
  context?: string;
  eventKey?: string | number | object;
}) {
  const heading = feedbackText(title ?? message);
  const detail = feedbackText(description);
  return (
    <FeedbackNotice
      source={source}
      title={heading || detail || '提示'}
      description={detail || undefined}
      content={typeof description === 'string' ? undefined : description}
      actions={action}
      type={type}
      context={context}
      eventKey={eventKey ?? JSON.stringify([heading, detail, type])}
      resetOnClear={false}
    />
  );
}

export type FeedbackAlertProps = {
  source: string;
  title?: ReactNode;
  message?: ReactNode;
  description?: ReactNode;
  type?: FeedbackEvent['type'];
  action?: ReactNode;
  context?: string;
  eventKey?: string | number | object;
};

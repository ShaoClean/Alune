import { createContext, isValidElement, useContext } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/**
 * Label, control and hint stacked on the dialog field rhythm.
 * Wraps the control in a <label> unless the control is labelled another way
 * (`htmlFor` for an id, `labelId` for aria-labelledby on Select / Switch / Segmented).
 */
export function DialogField({
  label,
  extra,
  hint,
  status,
  hintId,
  labelId,
  htmlFor,
  mono,
  className,
  children,
}: DialogFieldProps) {
  const labelContent = extra ? (
    <>
      <span>{label}</span>
      <small>{extra}</small>
    </>
  ) : (
    label
  );
  const labelNode =
    label === undefined ? null : htmlFor ? (
      <label className="dlg-fld-label" htmlFor={htmlFor}>
        {labelContent}
      </label>
    ) : (
      <span className="dlg-fld-label" id={labelId}>
        {labelContent}
      </span>
    );
  const hintNode =
    hint === undefined || hint === null || hint === false ? null : (
      <span
        id={hintId}
        className={join('dlg-fld-hint', status && `is-${status}`)}
        role={status || hintId ? 'status' : undefined}
      >
        {status ? <DialogIcon name={status === 'error' ? 'warning' : 'check'} /> : null}
        {hint}
      </span>
    );
  const Wrapper = htmlFor || labelId || label === undefined ? 'div' : 'label';
  return (
    <Wrapper className={join('dlg-fld', mono && 'is-mono', className)}>
      {labelNode}
      {children}
      {hintNode}
    </Wrapper>
  );
}

/** Two fields side by side; `end` narrows the second column for short values such as a port. */
export function DialogFieldRow({ end, children }: DialogFieldRowProps) {
  return <div className={end ? 'dlg-fld-row is-end' : 'dlg-fld-row'}>{children}</div>;
}

/** Small pill for state, counts and refs inside dialogs and cards. */
export function DialogBadge({ tone, mono, icon, className, children, ...props }: DialogBadgeProps) {
  return (
    <span {...props} className={join('dlg-badge', mono && 'is-mono', className)} data-tone={tone}>
      {icon ? <DialogIcon name={icon} /> : null}
      {children}
    </span>
  );
}

/** Wrapping row of badges or chip buttons. */
export function DialogBadges({ className, children, ...props }: DialogBadgesProps) {
  return (
    <span {...props} className={join('dlg-badges', className)}>
      {children}
    </span>
  );
}

const ListSemantics = createContext(false);

/** Divided list of items, usually inside a DialogCard. `as="ul"` makes items list items. */
export function DialogList({ as = 'div', scroll, className, children, ...props }: DialogListProps) {
  const Tag = as;
  return (
    <ListSemantics.Provider value={as === 'ul'}>
      <Tag {...props} className={join('dlg-list', scroll && 'is-scroll', className)}>
        {children}
      </Tag>
    </ListSemantics.Provider>
  );
}

/** One list row: icon, title, a detail line, and trailing actions. */
export function DialogListItem({
  icon,
  title,
  detail,
  done,
  className,
  children,
}: DialogListItemProps) {
  const Tag = useContext(ListSemantics) ? 'li' : 'div';
  return (
    <Tag className={join('dlg-list-item', done && 'is-done', className)}>
      {icon ? <DialogIcon name={icon} /> : null}
      <div className="dlg-list-main">
        <strong>{title}</strong>
        {detail === undefined || detail === null || detail === false ? null : isValidElement(
            detail,
          ) ? (
          detail
        ) : (
          <span className="dlg-path">{detail}</span>
        )}
      </div>
      {children}
    </Tag>
  );
}

export type DialogFieldProps = {
  label?: ReactNode;
  /** Muted text at the end of the label row, such as 可选 or a live value. */
  extra?: ReactNode;
  hint?: ReactNode;
  /** Paints the hint red or green, adds its icon and announces it. */
  status?: 'error' | 'ok';
  /** Id for the hint so the control can reference it with aria-describedby. */
  hintId?: string;
  /** Id of the label text, for controls labelled with aria-labelledby. */
  labelId?: string;
  /** Id of the control the label points at. */
  htmlFor?: string;
  /** Monospace input text for paths, refs and keys. */
  mono?: boolean;
  className?: string;
  children?: ReactNode;
};

export type DialogFieldRowProps = { end?: boolean; children: ReactNode };

export type DialogBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  tone?: Tone;
  mono?: boolean;
  icon?: DialogIconName;
  style?: CSSProperties;
  children?: ReactNode;
};

export type DialogBadgesProps = HTMLAttributes<HTMLSpanElement>;

export type DialogListProps = {
  as?: 'div' | 'ul';
  scroll?: boolean;
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
};

export type DialogListItemProps = {
  icon?: DialogIconName;
  title: ReactNode;
  /** Text gets the muted path styling; pass <DialogPath path /> to emphasise the last segment. */
  detail?: ReactNode;
  /** Dims a finished item. */
  done?: boolean;
  className?: string;
  children?: ReactNode;
};

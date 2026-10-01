import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { DialogIcon } from './DialogIcons';
import type { DialogIconName } from './DialogIcons';

type Tone = 'info' | 'success' | 'warning' | 'danger';

/** Double-bezel card used for repository summaries, ledgers and lists. */
export function DialogCard({
  children,
  pad,
  className,
}: {
  children: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return (
    <div className={className ? `dlg-card ${className}` : 'dlg-card'}>
      <div className={pad ? 'dlg-card-core dlg-card-pad' : 'dlg-card-core'}>{children}</div>
    </div>
  );
}

/** Path with the last segment emphasised. */
export function DialogPath({ path, className }: { path: string; className?: string }) {
  const match = /^(.*?[\\/])?([^\\/]+)[\\/]?$/.exec(path);
  return (
    <span className={className ? `dlg-path ${className}` : 'dlg-path'} title={path}>
      {match ? (
        <>
          {match[1]}
          <b>{match[2]}</b>
        </>
      ) : (
        path
      )}
    </span>
  );
}

export function RepoRow({
  name,
  path,
  icon = 'folder',
  children,
}: {
  name: ReactNode;
  path?: string;
  icon?: DialogIconName;
  children?: ReactNode;
}) {
  return (
    <div className="dlg-card-row">
      <span className="dlg-repo-tile" aria-hidden="true">
        <DialogIcon name={icon} />
      </span>
      <div className="dlg-repo-meta">
        <strong>{name}</strong>
        {path ? <DialogPath path={path} /> : null}
      </div>
      {children}
    </div>
  );
}

export function DialogStats({ children }: { children: ReactNode }) {
  return <div className="dlg-stats">{children}</div>;
}

export function DialogStat({
  value,
  label,
  tone,
  off,
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: Tone;
  off?: boolean;
}) {
  return (
    <div className={off ? 'dlg-stat is-off' : 'dlg-stat'} data-tone={off ? undefined : tone}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export interface LedgerItem {
  icon: DialogIconName;
  text: ReactNode;
}

/** Two columns: what the action will change and what it will keep. */
export function DialogLedger({
  change,
  keep,
  changeTitle = '将放弃',
  keepTitle = '将保留',
}: {
  change: LedgerItem[];
  keep: LedgerItem[];
  changeTitle?: ReactNode;
  keepTitle?: ReactNode;
}) {
  const column = (title: ReactNode, tone: Tone, items: LedgerItem[]) => (
    <div data-tone={tone}>
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <DialogIcon name={item.icon} />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <DialogCard>
      <div className="dlg-ledger">
        {column(changeTitle, 'danger', change)}
        {column(keepTitle, 'success', keep)}
      </div>
    </DialogCard>
  );
}

export function DialogNote({
  tone = 'info',
  icon,
  title,
  children,
  action,
  quiet,
  role,
}: {
  tone?: Tone;
  icon?: DialogIconName;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  quiet?: boolean;
  role?: 'alert' | 'status';
}) {
  const glyph =
    icon ??
    (tone === 'danger' || tone === 'warning' ? 'warning' : tone === 'success' ? 'check' : 'info');
  return (
    <div className={quiet ? 'dlg-note is-quiet' : 'dlg-note'} data-tone={tone} role={role}>
      <DialogIcon name={glyph} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? (
          typeof children === 'string' ? (
            <p className={title ? 'dlg-note-sub' : undefined}>{children}</p>
          ) : (
            children
          )
        ) : null}
      </div>
      {action ?? null}
    </div>
  );
}

export function DialogEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="dlg-empty">
      <span className="dlg-empty-moon" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

/** Progress with an optional ratio; without one the bar sweeps. */
export function DialogProgress({ value, label }: { value?: number; label?: ReactNode }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  return (
    <div className="dlg-status" role="status">
      <div
        className={known ? 'dlg-progress' : 'dlg-progress is-indeterminate'}
        style={known ? ({ '--p': Math.min(1, Math.max(0, value)) } as CSSProperties) : undefined}
        aria-hidden="true"
      >
        <i />
      </div>
      {label ? <p>{label}</p> : null}
    </div>
  );
}

export interface OptionCard<T extends string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  icon?: DialogIconName;
  disabled?: boolean;
}

/** Radio group drawn as cards; arrow keys move the selection like native radios. */
export function OptionCards<T extends string>({
  value,
  options,
  onChange,
  label,
  columns,
  disabled,
}: {
  value: T;
  options: OptionCard<T>[];
  onChange: (value: T) => void;
  label: string;
  columns?: number;
  disabled?: boolean;
}) {
  const enabled = options.filter((option) => !option.disabled && !disabled);
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step || !enabled.length) return;
    event.preventDefault();
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    onChange(next.value);
    const group = event.currentTarget.parentElement;
    requestAnimationFrame(() =>
      group?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus(),
    );
  };
  return (
    <div
      className="dlg-opt-grid"
      role="radiogroup"
      aria-label={label}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            className="dlg-opt"
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-value={option.value}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={move}
          >
            {option.icon ? <DialogIcon name={option.icon} /> : null}
            <strong>{option.title}</strong>
            {option.description ? <small>{option.description}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

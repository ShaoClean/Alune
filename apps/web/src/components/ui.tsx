import type { ReactNode } from 'react';
import { Alert, Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import {
  CodeOutlined,
  FileOutlined,
  FileTextOutlined,
  SettingOutlined,
} from '@ant-design/icons';

interface PanelHeaderProps {
  title: string;
  count?: number;
  description?: string;
  icon?: ReactNode;
  extra?: ReactNode;
}

export function PanelHeader({ title, count, description, icon, extra }: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <div className="panel-header__title-wrap">
        {icon && <span className="panel-header__icon">{icon}</span>}
        <div>
          <div className="panel-header__title">
            {title}
            {count !== undefined && <span className="count-badge">{count}</span>}
          </div>
          {description && <Typography.Text type="secondary">{description}</Typography.Text>}
        </div>
      </div>
      {extra && <div className="panel-header__actions">{extra}</div>}
    </div>
  );
}

export function CommandButton({
  label,
  children,
  danger = false,
  onClick,
  disabled,
}: {
  label: string;
  children: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip title={label}>
      <button
        type="button"
        aria-label={label}
        className={`icon-button${danger ? ' icon-button--danger' : ''}`}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function StatusBadge({
  status,
  label,
  subtle = false,
}: {
  status: string;
  label?: string;
  subtle?: boolean;
}) {
  const normalized = status.toLowerCase().replace(/\s+/g, '-');
  return (
    <span className={`status-badge status-badge--${normalized}${subtle ? ' status-badge--subtle' : ''}`}>
      <span className="status-badge__dot" />
      {label || status}
    </span>
  );
}

export function FileIcon({ path, status }: { path: string; status?: string }) {
  const extension = path.split('.').pop()?.toLowerCase();
  const Icon = ['ts', 'tsx', 'js', 'jsx', 'json', 'css', 'scss', 'html'].includes(extension || '')
    ? CodeOutlined
    : ['md', 'txt', 'yml', 'yaml'].includes(extension || '')
      ? FileTextOutlined
      : ['env', 'config'].includes(extension || '')
        ? SettingOutlined
        : FileOutlined;
  return <Icon className={`file-icon${status ? ` file-icon--${status}` : ''}`} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />
      <Typography.Title level={4}>{title}</Typography.Title>
      {description && <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading workspace…' }: { label?: string }) {
  return (
    <div className="loading-state">
      <Spin />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = 'Unable to load this view',
  description,
  onRetry,
}: {
  title?: string;
  description?: string | null;
  onRetry?: () => void;
}) {
  return (
    <Alert
      className="error-state"
      type="error"
      showIcon
      message={title}
      description={description || 'Check the connection and try again.'}
      action={onRetry ? <button className="text-button" type="button" onClick={onRetry}>Retry</button> : undefined}
    />
  );
}

export function formatRelativeDate(value?: string | Date) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatBranchName(value?: string) {
  return value?.replace(/^branch\.head\s+/i, '') || '—';
}

export function RefBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const kind = value === 'HEAD' ? 'head' : lower.startsWith('tag:') ? 'tag' : lower.includes('origin/') || lower.includes('remote') ? 'remote' : 'branch';
  return <Tag className={`ref-badge ref-badge--${kind}`}>{value.replace(/^tag:\s*/, '')}</Tag>;
}

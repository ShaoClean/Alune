import type { ReactNode } from 'react';
import { Alert, Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import typescriptIcon from 'material-icon-theme/icons/typescript.svg';
import reactTypescriptIcon from 'material-icon-theme/icons/react_ts.svg';
import javascriptIcon from 'material-icon-theme/icons/javascript.svg';
import reactIcon from 'material-icon-theme/icons/react.svg';
import jsonIcon from 'material-icon-theme/icons/json.svg';
import cssIcon from 'material-icon-theme/icons/css.svg';
import sassIcon from 'material-icon-theme/icons/sass.svg';
import markdownIcon from 'material-icon-theme/icons/markdown.svg';
import yamlIcon from 'material-icon-theme/icons/yaml.svg';
import pythonIcon from 'material-icon-theme/icons/python.svg';
import goIcon from 'material-icon-theme/icons/go.svg';
import rustIcon from 'material-icon-theme/icons/rust.svg';
import vueIcon from 'material-icon-theme/icons/vue.svg';
import htmlIcon from 'material-icon-theme/icons/html.svg';
import svgIcon from 'material-icon-theme/icons/svg.svg';
import consoleIcon from 'material-icon-theme/icons/console.svg';
import documentIcon from 'material-icon-theme/icons/document.svg';
import settingsIcon from 'material-icon-theme/icons/settings.svg';
import gitIcon from 'material-icon-theme/icons/git.svg';
import dockerIcon from 'material-icon-theme/icons/docker.svg';
import npmIcon from 'material-icon-theme/icons/npm.svg';
import tsconfigIcon from 'material-icon-theme/icons/tsconfig.svg';
import genericFileIcon from 'material-icon-theme/icons/file.svg';

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

const fileIcons: Record<string, string> = {
  ts: typescriptIcon,
  tsx: reactTypescriptIcon,
  js: javascriptIcon,
  jsx: reactIcon,
  mjs: javascriptIcon,
  cjs: javascriptIcon,
  json: jsonIcon,
  jsonc: jsonIcon,
  css: cssIcon,
  scss: sassIcon,
  sass: sassIcon,
  md: markdownIcon,
  mdx: markdownIcon,
  yml: yamlIcon,
  yaml: yamlIcon,
  py: pythonIcon,
  go: goIcon,
  rs: rustIcon,
  vue: vueIcon,
  html: htmlIcon,
  htm: htmlIcon,
  svg: svgIcon,
  sh: consoleIcon,
  txt: documentIcon,
};

const namedFileIcons: Record<string, string> = {
  'package.json': npmIcon,
  'package-lock.json': npmIcon,
  'tsconfig.json': tsconfigIcon,
  '.gitignore': gitIcon,
  '.gitattributes': gitIcon,
};

export function FileIcon({ path }: { path: string }) {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() || '';
  const extension = name.split('.').pop() || '';
  const icon = name.startsWith('.env')
    ? settingsIcon
    : name.startsWith('dockerfile') || name === '.dockerignore'
      ? dockerIcon
      : namedFileIcons[name] || fileIcons[extension] || genericFileIcon;

  return <img className="file-icon" src={icon} alt="" aria-hidden="true" draggable={false} />;
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

export function LoadingState({ label = '正在加载工作区…' }: { label?: string }) {
  return (
    <div className="loading-state">
      <Spin />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = '无法加载当前页面',
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
      description={description || '请检查连接后重试。'}
      action={onRetry ? <button className="text-button" type="button" onClick={onRetry}>重试</button> : undefined}
    />
  );
}

export function formatRelativeDate(value?: string | Date) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatBranchName(value?: string) {
  return value?.replace(/^branch\.head\s+/i, '') || '—';
}

export function RefBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const kind = value === 'HEAD' ? 'head' : lower.startsWith('tag:') ? 'tag' : lower.includes('origin/') || lower.includes('remote') ? 'remote' : 'branch';
  return <Tag className={`ref-badge ref-badge--${kind}`}>{value.replace(/^tag:\s*/, '')}</Tag>;
}

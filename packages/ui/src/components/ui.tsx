import { useContext } from 'react';
import { FeedbackContext } from './feedback-context';
import { ScopeContext } from './FeedbackNotice';
import { FeedbackAlert } from './FeedbackAlert';
import type { ReactNode } from 'react';
import { Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import typescriptIcon from 'material-icon-theme/icons/typescript.svg?url';
import reactTypescriptIcon from 'material-icon-theme/icons/react_ts.svg?url';
import javascriptIcon from 'material-icon-theme/icons/javascript.svg?url';
import reactIcon from 'material-icon-theme/icons/react.svg?url';
import jsonIcon from 'material-icon-theme/icons/json.svg?url';
import cssIcon from 'material-icon-theme/icons/css.svg?url';
import sassIcon from 'material-icon-theme/icons/sass.svg?url';
import markdownIcon from 'material-icon-theme/icons/markdown.svg?url';
import yamlIcon from 'material-icon-theme/icons/yaml.svg?url';
import pythonIcon from 'material-icon-theme/icons/python.svg?url';
import goIcon from 'material-icon-theme/icons/go.svg?url';
import rustIcon from 'material-icon-theme/icons/rust.svg?url';
import vueIcon from 'material-icon-theme/icons/vue.svg?url';
import htmlIcon from 'material-icon-theme/icons/html.svg?url';
import svgIcon from 'material-icon-theme/icons/svg.svg?url';
import consoleIcon from 'material-icon-theme/icons/console.svg?url';
import documentIcon from 'material-icon-theme/icons/document.svg?url';
import settingsIcon from 'material-icon-theme/icons/settings.svg?url';
import gitIcon from 'material-icon-theme/icons/git.svg?url';
import dockerIcon from 'material-icon-theme/icons/docker.svg?url';
import npmIcon from 'material-icon-theme/icons/npm.svg?url';
import tsconfigIcon from 'material-icon-theme/icons/tsconfig.svg?url';
import genericFileIcon from 'material-icon-theme/icons/file.svg?url';
import imageIcon from 'material-icon-theme/icons/image.svg?url';
import folderIcon from 'material-icon-theme/icons/folder.svg?url';
import folderOpenIcon from 'material-icon-theme/icons/folder-open.svg?url';
import folderGitIcon from 'material-icon-theme/icons/folder-git.svg?url';
import folderLinkIcon from 'material-icon-theme/icons/folder-link.svg?url';

export interface PanelHeaderProps {
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
    <span
      className={`status-badge status-badge--${normalized}${subtle ? ' status-badge--subtle' : ''}`}
    >
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
  png: imageIcon,
  jpg: imageIcon,
  jpeg: imageIcon,
  gif: imageIcon,
  webp: imageIcon,
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

// Folder glyphs for the read-only file tree: nested repositories and links get
// their own shapes so they do not look expandable like ordinary folders.
export function FolderIcon({
  open = false,
  variant = 'folder',
}: {
  open?: boolean;
  variant?: 'folder' | 'repository' | 'link';
}) {
  const icon =
    variant === 'repository'
      ? folderGitIcon
      : variant === 'link'
        ? folderLinkIcon
        : open
          ? folderOpenIcon
          : folderIcon;
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
  announce = true,
}: {
  title?: string;
  description?: string | null;
  onRetry?: () => void;
  announce?: boolean;
}) {
  const store = useContext(FeedbackContext);
  const scope = useContext(ScopeContext);
  const source = `page-error:${title}`;
  const retry = () => {
    store?.getState().rearm(JSON.stringify([scope.id, source, undefined]));
    onRetry?.();
  };
  return (
    <>
      {announce && (
        <FeedbackAlert
          source={source}
          type="error"
          title={title}
          description={description || '请检查连接后重试。'}
          action={
            onRetry && (
              <button className="text-button" type="button" onClick={retry}>
                重试
              </button>
            )
          }
        />
      )}
      <EmptyState
        title={title}
        action={
          onRetry && (
            <button className="text-button" type="button" onClick={retry}>
              重试
            </button>
          )
        }
      />
    </>
  );
}

export function RefBadge({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const kind =
    value === 'HEAD'
      ? 'head'
      : lower.startsWith('tag:')
        ? 'tag'
        : lower.includes('origin/') || lower.includes('remote')
          ? 'remote'
          : 'branch';
  return <Tag className={`ref-badge ref-badge--${kind}`}>{value.replace(/^tag:\s*/, '')}</Tag>;
}

export type CommandButtonProps = {
  label: string;
  children: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  disabled?: boolean;
};

export type StatusBadgeProps = {
  status: string;
  label?: string;
  subtle?: boolean;
};

export type FileIconProps = { path: string };

export type FolderIconProps = {
  open?: boolean;
  variant?: 'folder' | 'repository' | 'link';
};

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export type LoadingStateProps = { label?: string };

export type ErrorStateProps = {
  title?: string;
  description?: string | null;
  onRetry?: () => void;
  announce?: boolean;
};

export type RefBadgeProps = { value: string };

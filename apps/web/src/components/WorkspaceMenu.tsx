import { useRef, useState } from 'react';
import { Dropdown } from 'antd';
import { QuestionCircleOutlined, SettingOutlined, UpOutlined } from '@ant-design/icons';
import { BrandIcon } from './BrandIcon';

export function WorkspaceMenu({
  compact = false,
  version,
  onSettings,
}: {
  compact?: boolean;
  version: string;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <Dropdown
      trigger={['click']}
      placement={compact ? 'bottomLeft' : 'topLeft'}
      open={open}
      onOpenChange={setOpen}
      autoFocus
      classNames={{ root: 'workspace-menu' }}
      menu={{
        'aria-label': '应用菜单',
        items: [
          {
            key: 'settings',
            icon: <SettingOutlined />,
            label: (
              <span className="workspace-menu__label">
                设置<kbd>⌘ / Ctrl ,</kbd>
              </span>
            ),
            onClick: onSettings,
          },
          { type: 'divider' },
          {
            key: 'help',
            icon: <QuestionCircleOutlined />,
            label: (
              <a
                href="https://github.com/ShaoClean/remote-git/wiki"
                target="_blank"
                rel="noreferrer"
              >
                帮助与文档
              </a>
            ),
          },
        ],
        onClick: close,
        onKeyDown: (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
        },
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`workspace-menu-trigger${compact ? ' workspace-menu-trigger--compact' : ''}`}
        aria-label="设置与帮助"
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <BrandIcon />
        {!compact && (
          <>
            <strong>RemoteGit</strong>
            <span className="workspace-menu-version">{version}</span>
            <UpOutlined />
          </>
        )}
      </button>
    </Dropdown>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  CheckOutlined,
  CloudServerOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  RightOutlined,
  SettingOutlined,
  UpOutlined,
} from '@ant-design/icons';
import type { Repository } from '@remote-git/shared';
import { BrandIcon } from './BrandIcon';

interface ConnectionSummary {
  id: string;
  name: string;
  host?: string;
  port?: number;
  username?: string;
}

interface Props {
  repository?: Repository | null;
  repositories: Repository[];
  connections: ConnectionSummary[];
  onSelect: (id: string) => void;
  onBrowse: () => void;
  onConnections: () => void;
}

const endpointLabel = (connection?: ConnectionSummary) => {
  if (!connection?.host) return '';
  const host = connection.username ? `${connection.username}@${connection.host}` : connection.host;
  return connection.port && connection.port !== 22 ? `${host}:${connection.port}` : host;
};

export function RepositorySwitcher({
  repository,
  repositories,
  connections,
  onSelect,
  onBrowse,
  onConnections,
}: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const activeConnection = repository ? connectionById.get(repository.connectionId) : undefined;
  const activeConnectionLabel = activeConnection?.name || repository?.connectionId || '未知连接';
  const contextLabel = repository
    ? `${activeConnectionLabel} / ${repository.name}`
    : repositories.length
      ? '选择已打开仓库'
      : '暂无已打开仓库';
  const contextDetail = repository
    ? [activeConnectionLabel, endpointLabel(activeConnection), repository.name, repository.path]
        .filter(Boolean)
        .join(' · ')
    : contextLabel;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      panel.current
        ?.querySelector<HTMLElement>('.repository-switcher-menu__repository-item--active')
        ?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, repository?.id]);

  const groupedRepositories = useMemo(() => {
    const groups = new Map<
      string,
      { connection?: ConnectionSummary; connectionId: string; repositories: Repository[] }
    >();
    for (const item of repositories) {
      const group = groups.get(item.connectionId) || {
        connection: connectionById.get(item.connectionId),
        connectionId: item.connectionId,
        repositories: [],
      };
      group.repositories.push(item);
      groups.set(item.connectionId, group);
    }
    return [...groups.values()];
  }, [connectionById, repositories]);

  const closeAndFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const selectRepository = (id: string) => {
    closeAndFocus();
    onSelect(id);
  };
  const openPage = (callback: () => void) => {
    closeAndFocus();
    callback();
  };

  const repositoryItems: MenuProps['items'] = repositories.length
    ? groupedRepositories.map((group): NonNullable<MenuProps['items']>[number] => ({
        type: 'group',
        key: `connection:${group.connectionId}`,
        label: (
          <span className="repository-switcher-group">
            <CloudServerOutlined />
            <span className="repository-switcher-group__identity">
              <strong>{group.connection?.name || group.connectionId}</strong>
              {endpointLabel(group.connection) && <small>{endpointLabel(group.connection)}</small>}
            </span>
            <span className="repository-switcher-group__count">{group.repositories.length}</span>
          </span>
        ),
        children: group.repositories.map((item) => {
          const active = item.id === repository?.id;
          return {
            key: `repository:${item.id}`,
            className: `repository-switcher-menu__repository-item${active ? ' repository-switcher-menu__repository-item--active' : ''}`,
            icon: <CodeOutlined />,
            label: (
              <span className="repository-switcher-item" title={`${item.name} · ${item.path}`}>
                <span className="repository-switcher-item__heading">
                  <strong>{item.name}</strong>
                  {item.isDirty && (
                    <span className="repository-switcher-item__dirty" aria-label="有改动" />
                  )}
                  {active && <CheckOutlined className="repository-switcher-item__check" />}
                </span>
                <small>
                  {item.currentBranch ? `${item.currentBranch} · ` : ''}
                  {item.path || '仓库工作区'}
                </small>
              </span>
            ),
            onClick: () => selectRepository(item.id),
          };
        }),
      }))
    : [
        {
          key: '__empty',
          disabled: true,
          className: 'repository-switcher-menu__empty-item',
          label: (
            <span className="repository-switcher-menu__empty">
              <span className="repository-switcher-menu__empty-icon">
                <FolderOpenOutlined />
              </span>
              <strong>还没有打开的仓库</strong>
              <small>从下方浏览并打开一个工作区</small>
            </span>
          ),
        },
      ];

  const openFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <Dropdown
      trigger={['click']}
      placement="topLeft"
      autoFocus
      transitionName="repository-switcher-motion"
      destroyOnHidden
      open={open}
      onOpenChange={setOpen}
      classNames={{ root: 'repository-switcher-menu' }}
      popupRender={(menu) => (
        <section
          ref={panel}
          className="repository-switcher-panel"
          aria-label="仓库切换面板"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closeAndFocus();
            }
          }}
        >
          <header className="repository-switcher-panel__header">
            <span className="repository-switcher-panel__title">
              <span className="repository-switcher-panel__title-icon" aria-hidden="true">
                <BrandIcon className="repository-switcher-panel__title-mark" />
              </span>
              <span>
                <strong>切换仓库</strong>
                <small>
                  {repositories.length
                    ? `${repositories.length} 个仓库 · 按远程连接归类`
                    : '从工作区打开一个仓库'}
                </small>
              </span>
            </span>
            <span
              className="repository-switcher-menu__total"
              aria-label={`${repositories.length} 个已打开仓库`}
            >
              {repositories.length}
            </span>
          </header>

          <div className="repository-switcher-panel__list">{menu}</div>

          <footer className="repository-switcher-panel__footer">
            <button
              type="button"
              className="repository-switcher-panel__action"
              onClick={() => openPage(onBrowse)}
            >
              <FolderOpenOutlined />
              <span>
                <strong>浏览仓库</strong>
                <small>查看全部工作区</small>
              </span>
              <RightOutlined />
            </button>
            <button
              type="button"
              className="repository-switcher-panel__action"
              onClick={() => openPage(onConnections)}
            >
              <SettingOutlined />
              <span>
                <strong>远程连接</strong>
                <small>管理 SSH 主机</small>
              </span>
              <RightOutlined />
            </button>
          </footer>
        </section>
      )}
      menu={{
        id: 'open-repository-menu',
        'aria-label': '已打开仓库',
        selectable: true,
        selectedKeys: repository ? [`repository:${repository.id}`] : [],
        items: repositoryItems,
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="repository-switcher"
        title={contextDetail}
        aria-label={`切换仓库，${contextLabel}，共 ${repositories.length} 个已打开仓库`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'open-repository-menu' : undefined}
        onKeyDown={openFromKeyboard}
      >
        <span className="repository-switcher__icon" aria-hidden="true">
          <BrandIcon className="repository-switcher__icon-mark" />
        </span>
        <span className="repository-switcher__context">
          {repository ? (
            <>
              <span className="repository-switcher__connection">{activeConnectionLabel}</span>
              <RightOutlined className="repository-switcher__separator" />
              <strong className="repository-switcher__repository">{repository.name}</strong>
            </>
          ) : (
            <strong className="repository-switcher__repository">已打开仓库</strong>
          )}
        </span>
        {repository?.isDirty && <span className="repository-switcher__dirty" aria-label="有改动" />}
        <span
          className="repository-switcher__count"
          aria-label={`${repositories.length} 个已打开仓库`}
        >
          {repositories.length}
        </span>
        <UpOutlined className="repository-switcher__chevron" aria-hidden="true" />
      </button>
    </Dropdown>
  );
}

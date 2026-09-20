import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Dropdown, Input } from 'antd';
import type { InputRef, MenuProps } from 'antd';
import {
  CheckOutlined,
  CloudServerOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  UpOutlined,
} from '@ant-design/icons';
import type { ConnectionStatusInfo, Repository } from '@remote-git/shared';
import { connectionStatus, connectionStatusLabel } from '../stores/connectionStatus';
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
  statuses: Record<string, ConnectionStatusInfo>;
  version: string;
  onSelect: (id: string) => void;
  onBrowse: () => void;
  onConnections: () => void;
  onSettings: () => void;
}

const endpointLabel = (connection?: ConnectionSummary) => {
  if (!connection?.host) return '';
  const host = connection.username ? `${connection.username}@${connection.host}` : connection.host;
  return connection.port && connection.port !== 22 ? `${host}:${connection.port}` : host;
};

const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase();

export const filterRepositories = (
  repositories: Repository[],
  connections: ConnectionSummary[],
  query: string,
) => {
  const search = normalizeSearch(query);
  if (!search) return repositories;
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
  return repositories.filter((repository) => {
    const connection = connectionById.get(repository.connectionId);
    return [
      repository.name,
      repository.path,
      repository.currentBranch,
      connection?.name,
      endpointLabel(connection),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(search));
  });
};

export function RepositorySwitcher({
  repository,
  repositories,
  connections,
  statuses,
  version,
  onSelect,
  onBrowse,
  onConnections,
  onSettings,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const search = useRef<InputRef>(null);
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const activeConnection = repository ? connectionById.get(repository.connectionId) : undefined;
  const activeConnectionLabel = activeConnection?.name || repository?.connectionId || '未知连接';
  const contextLabel = repository
    ? `${activeConnectionLabel} / ${repository.name}`
    : repositories.length
      ? 'RemoteGit'
      : 'RemoteGit，暂无已打开仓库';
  const contextDetail = repository
    ? [activeConnectionLabel, endpointLabel(activeConnection), repository.name, repository.path]
        .filter(Boolean)
        .join(' · ')
    : contextLabel;
  const filteredRepositories = useMemo(
    () => filterRepositories(repositories, connections, query),
    [connections, query, repositories],
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const frame = requestAnimationFrame(() => {
      search.current?.focus();
      panel.current
        ?.querySelector<HTMLElement>('.repository-switcher-menu__repository-item--active')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, repository?.id]);

  const groupedRepositories = useMemo(() => {
    const groups = new Map<
      string,
      { connection?: ConnectionSummary; connectionId: string; repositories: Repository[] }
    >();
    for (const item of filteredRepositories) {
      const group = groups.get(item.connectionId) || {
        connection: connectionById.get(item.connectionId),
        connectionId: item.connectionId,
        repositories: [],
      };
      group.repositories.push(item);
      groups.set(item.connectionId, group);
    }
    return [...groups.values()];
  }, [connectionById, filteredRepositories]);

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

  const repositoryItems: MenuProps['items'] = filteredRepositories.length
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
            <span
              className="repository-switcher-group__status"
              title={connectionStatusLabel(statuses[group.connectionId])}
            >
              <span
                className={`connection-dot connection-dot--${connectionStatus(statuses[group.connectionId])}`}
                aria-hidden="true"
              />
              {connectionStatusLabel(statuses[group.connectionId])}
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
                {query ? <SearchOutlined /> : <FolderOpenOutlined />}
              </span>
              <strong>{query ? '没有匹配的仓库' : '还没有打开的仓库'}</strong>
              <small>{query ? '请尝试仓库名、分支、路径或连接名' : '从下方浏览并打开一个工作区'}</small>
            </span>
          ),
        },
      ];

  const openFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <Dropdown
      trigger={['click']}
      placement="topLeft"
      transitionName="repository-switcher-motion"
      destroyOnHidden
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) requestAnimationFrame(() => trigger.current?.focus());
      }}
      classNames={{ root: 'repository-switcher-menu' }}
      popupRender={(menu) => (
        <section
          ref={panel}
          className="repository-switcher-panel"
          aria-label="工作区导航"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
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
                <strong>已打开仓库</strong>
                <small>{repositories.length} 个仓库 · 按远程连接分组</small>
              </span>
            </span>
            <span
              className="repository-switcher-menu__total"
              aria-label={`${repositories.length} 个已打开仓库`}
            >
              {repositories.length}
            </span>
          </header>

          <div className="repository-switcher-panel__search">
            <Input
              ref={search}
              allowClear
              aria-label="搜索已打开的仓库"
              placeholder="搜索已打开的仓库…"
              prefix={<SearchOutlined />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown') return;
                event.preventDefault();
                panel.current
                  ?.querySelector<HTMLElement>('.ant-dropdown-menu-item:not(.ant-dropdown-menu-item-disabled)')
                  ?.focus();
              }}
            />
          </div>

          <div className="repository-switcher-panel__list">{menu}</div>

          <div className="repository-switcher-panel__sections">
            <section aria-label="工作区入口">
              <button
                type="button"
                className="repository-switcher-panel__action"
                onClick={() => openPage(onBrowse)}
              >
                <FolderOpenOutlined />
                <span>
                  <strong>浏览全部仓库</strong>
                  <small>查看并打开工作区</small>
                </span>
                <RightOutlined />
              </button>
              <button
                type="button"
                className="repository-switcher-panel__action"
                onClick={() => openPage(onConnections)}
              >
                <CloudServerOutlined />
                <span>
                  <strong>管理远程连接</strong>
                  <small>配置 SSH 主机</small>
                </span>
                <RightOutlined />
              </button>
            </section>
            <section aria-label="应用入口">
              <button
                type="button"
                className="repository-switcher-panel__action"
                onClick={() => openPage(onSettings)}
              >
                <SettingOutlined />
                <span>
                  <strong>设置</strong>
                  <small>⌘ / Ctrl ,</small>
                </span>
                <RightOutlined />
              </button>
              <a
                className="repository-switcher-panel__action"
                href="https://github.com/ShaoClean/remote-git/wiki"
                target="_blank"
                rel="noreferrer"
                onClick={closeAndFocus}
              >
                <QuestionCircleOutlined />
                <span>
                  <strong>帮助与文档</strong>
                  <small>使用指南和常见问题</small>
                </span>
                <RightOutlined />
              </a>
            </section>
          </div>

          <footer className="repository-switcher-panel__footer">
            <span>RemoteGit</span>
            <span>{version}</span>
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
        aria-label={`工作区导航，${contextLabel}，共 ${repositories.length} 个已打开仓库`}
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
            <strong className="repository-switcher__repository">RemoteGit</strong>
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

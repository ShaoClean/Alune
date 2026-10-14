import { useNavigate } from 'react-router-dom';
import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InputRef } from 'antd';
import { Input, MoonLoader, Popover } from '@alune/ui';
import {
  BranchesOutlined,
  CheckOutlined,
  DownOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { gitApi } from '../api';
import { useRepositoryStore, useWorkspaceData } from '../stores/repositoryStore';
import { useBranchSwitch } from '../hooks/useBranchSwitch';
import { ToolbarButton } from '@alune/ui';
import { NewBranchDialog } from './BranchesView';
import { moveActiveIndex } from './branch-picker-navigation';

const LISTBOX_ID = 'branch-picker-listbox';
const optionId = (index: number) => `branch-picker-option-${index}`;

// The pill is a context selector, so clicking it opens the switch list instead of
// navigating to the branch view. Branch management stays reachable from the overflow menu.
export function BranchPicker({
  repoId,
  branch,
  behind,
  disabled = false,
  maxWidth,
  onSwitched,
}: {
  repoId: string;
  branch: string;
  behind?: number;
  disabled?: boolean;
  maxWidth?: number;
  onSwitched: () => void;
}) {
  const navigate = useNavigate();
  const message = useFeedbackMessage();
  const branches = useWorkspaceData(repoId, (workspace) => workspace.branches);
  const fetchBranches = useRepositoryStore((state) => state.fetchBranches);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState<string | null>(null);
  const { switching: switchingBranch, switchBranch: switchTo } = useBranchSwitch(repoId, () => {
    if (!mounted.current) return;
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
    onSwitched();
  });
  const switching = switchingBranch ?? creatingBranch;
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<InputRef>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      await fetchBranches(repoId);
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const local = useMemo(() => branches.filter((item: any) => !item.isRemote), [branches]);
  const remote = useMemo(() => branches.filter((item: any) => item.isRemote), [branches]);
  const match = (list: any[]) =>
    query.trim()
      ? list.filter((item: any) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
      : list;
  const visibleLocal = match(local);
  const visibleRemote = match(remote);
  const options = [...visibleLocal, ...visibleRemote];
  const active = activeIndex >= 0 && activeIndex < options.length ? activeIndex : -1;

  // A new filter or a freshly opened panel always starts from the first match.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, active]);

  const choose = (item: any) => {
    if (!item || item.isCurrent || switching !== null) return;
    void switchTo(item.name, item.isRemote);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  };

  const create = async () => {
    const name = newBranch.trim();
    if (!name) return;
    setCreatingBranch(name);
    try {
      await gitApi.createBranch(repoId, name, true);
      if (!mounted.current) return;
      setCreating(false);
      setNewBranch('');
      setOpen(false);
      onSwitched();
    } catch (err: any) {
      message.error(err.message || '无法创建分支');
    } finally {
      if (mounted.current) setCreatingBranch(null);
    }
  };

  const row = (item: any, index: number) => {
    const unavailable = item.isCurrent || switching !== null;
    return (
      <div
        key={`${item.isRemote ? 'remote' : 'local'}-${item.name}`}
        id={optionId(index)}
        role="option"
        className={`branch-picker__option${item.isCurrent ? ' branch-picker__option--current' : ''}${index === active ? ' branch-picker__option--active' : ''}`}
        aria-selected={index === active}
        aria-current={item.isCurrent ? 'true' : undefined}
        aria-disabled={unavailable || undefined}
        aria-label={item.isCurrent ? `当前分支 ${item.name}` : `切换到 ${item.name}`}
        // Keep focus in the filter so typing and arrow keys continue after a click.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (index !== active) setActiveIndex(index);
        }}
        onClick={() => choose(item)}
      >
        <span className="branch-picker__check">
          {item.isCurrent ? <CheckOutlined /> : switching === item.name ? <MoonLoader /> : null}
        </span>
        <span className="branch-picker__name">{item.name}</span>
        {item.isCurrent && !!behind && <span className="toolbar-count">↓{behind}</span>}
      </div>
    );
  };

  return (
    <>
      <Popover
        trigger="click"
        placement="bottomRight"
        align={{ overflow: { shiftX: true, adjustY: true } }}
        arrow={false}
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) void load();
          else setQuery('');
        }}
        afterOpenChange={(value) => {
          if (value) search.current?.focus();
        }}
        content={
          <section
            id="branch-picker-panel"
            className="branch-picker"
            aria-label="切换分支"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                close();
              }
            }}
          >
            <div className="branch-picker__search">
              <Input
                ref={search}
                size="middle"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="筛选分支…"
                aria-label="筛选分支"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={LISTBOX_ID}
                aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveIndex(
                      moveActiveIndex(active, event.key === 'ArrowDown' ? 1 : -1, options.length),
                    );
                  } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    choose(options[active]);
                  }
                }}
              />
            </div>
            {loading && (
              <p className="branch-picker__empty" role="status">
                正在读取分支…
              </p>
            )}
            {!loading && !visibleLocal.length && !visibleRemote.length && (
              <p className="branch-picker__empty">没有匹配的分支</p>
            )}
            <div id={LISTBOX_ID} role="listbox" aria-label="分支" className="branch-picker__list">
              {visibleLocal.length > 0 && (
                <div
                  role="group"
                  aria-labelledby="branch-picker-group-local"
                  className="branch-picker__section"
                >
                  <div
                    id="branch-picker-group-local"
                    role="presentation"
                    className="branch-picker__group"
                  >
                    本地
                  </div>
                  {visibleLocal.map((item, index) => row(item, index))}
                </div>
              )}
              {visibleRemote.length > 0 && (
                <div
                  role="group"
                  aria-labelledby="branch-picker-group-remote"
                  className="branch-picker__section"
                >
                  <div
                    id="branch-picker-group-remote"
                    role="presentation"
                    className="branch-picker__group"
                  >
                    远程
                  </div>
                  {visibleRemote.map((item, index) => row(item, visibleLocal.length + index))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="branch-picker__create"
              disabled={switching !== null || !branch}
              onClick={() => {
                close();
                navigate(
                  `/repositories/${repoId}?${new URLSearchParams({ panel: 'pull-requests', createPr: '1', sourceBranch: branch })}`,
                );
              }}
            >
              创建 PR/MR…
            </button>
            <button
              type="button"
              className="branch-picker__create"
              disabled={switching !== null}
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <PlusOutlined />
              新建分支…
            </button>
          </section>
        }
      >
        <ToolbarButton
          ref={trigger}
          variant="action"
          className="branch-pill"
          style={maxWidth ? { maxWidth } : undefined}
          label={`当前分支 ${branch}，切换分支`}
          tooltip={`当前分支 · ${branch} · 点击切换`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? 'branch-picker-panel' : undefined}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                void load();
              }
            }
          }}
        >
          <BranchesOutlined />
          <span className="branch-pill__name">{branch}</span>
          <DownOutlined className="branch-pill__chevron" />
        </ToolbarButton>
      </Popover>
      <NewBranchDialog
        open={creating}
        repoId={repoId}
        value={newBranch}
        busy={switching !== null}
        onChange={setNewBranch}
        onCreate={create}
        onCancel={() => {
          setCreating(false);
          setNewBranch('');
        }}
      />
    </>
  );
}

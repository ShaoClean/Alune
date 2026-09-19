import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Modal, Popover, message } from 'antd';
import {
  BranchesOutlined,
  CheckOutlined,
  DownOutlined,
  LoadingOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { gitApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { ToolbarButton } from './ToolbarButton';
import { useMenuAlign } from '../hooks/useMenuAlign';

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
  const branches = useRepositoryStore((state) => state.branches);
  const fetchBranches = useRepositoryStore((state) => state.fetchBranches);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const { measure, align } = useMenuAlign();

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

  const local = useMemo(
    () => branches.filter((item: any) => !item.isRemote),
    [branches],
  );
  const remote = useMemo(() => branches.filter((item: any) => item.isRemote), [branches]);
  const match = (list: any[]) =>
    query.trim()
      ? list.filter((item: any) =>
          item.name.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : list;
  const visibleLocal = match(local);
  const visibleRemote = match(remote);

  const close = () => {
    setOpen(false);
    setQuery('');
    trigger.current?.focus();
  };

  const switchTo = async (name: string) => {
    if (switching) return;
    setSwitching(name);
    try {
      await gitApi.switchBranch(repoId, name.replace(/^origin\//, ''));
      message.success(`已切换到“${name}”`);
      if (!mounted.current) return;
      setOpen(false);
      setQuery('');
      onSwitched();
    } catch (err: any) {
      message.error(err.message || '无法切换分支');
    } finally {
      if (mounted.current) setSwitching(null);
    }
  };

  const create = async () => {
    const name = newBranch.trim();
    if (!name) return;
    setSwitching(name);
    try {
      await gitApi.createBranch(repoId, name, true);
      message.success(`分支“${name}”已创建并切换`);
      if (!mounted.current) return;
      setCreating(false);
      setNewBranch('');
      setOpen(false);
      onSwitched();
    } catch (err: any) {
      message.error(err.message || '无法创建分支');
    } finally {
      if (mounted.current) setSwitching(null);
    }
  };

  const row = (item: any) => (
    <button
      type="button"
      key={`${item.isRemote ? 'remote' : 'local'}-${item.name}`}
      className={`branch-picker__option${item.isCurrent ? ' branch-picker__option--current' : ''}`}
      aria-current={item.isCurrent ? 'true' : undefined}
      disabled={item.isCurrent || switching !== null}
      aria-label={item.isCurrent ? `当前分支 ${item.name}` : `切换到 ${item.name}`}
      onClick={() => void switchTo(item.name)}
    >
      <span className="branch-picker__check">
        {item.isCurrent ? <CheckOutlined /> : switching === item.name ? <LoadingOutlined /> : null}
      </span>
      <span className="branch-picker__name">{item.name}</span>
      {item.isCurrent && !!behind && <span className="toolbar-count">↓{behind}</span>}
    </button>
  );

  return (
    <>
      <Popover
        trigger="click"
        align={align}
        arrow={false}
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) {
            measure(trigger.current);
            void load();
          } else setQuery('');
        }}
        afterOpenChange={(value) => {
          if (value) panel.current?.focus();
        }}
        content={
          <section
            ref={panel}
            tabIndex={-1}
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
                size="small"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="筛选分支…"
                aria-label="筛选分支"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {loading && <p role="status">正在读取分支…</p>}
            {!loading && !visibleLocal.length && !visibleRemote.length && (
              <p className="branch-picker__empty">没有匹配的分支</p>
            )}
            <div className="branch-picker__list">
              {visibleLocal.length > 0 && <div className="branch-picker__group">本地</div>}
              {visibleLocal.map(row)}
              {visibleRemote.length > 0 && <div className="branch-picker__group">远程</div>}
              {visibleRemote.map(row)}
            </div>
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
      <Modal
        title="新建分支"
        open={creating}
        okText="创建并切换"
        confirmLoading={switching !== null}
        onOk={() => void create()}
        onCancel={() => {
          setCreating(false);
          setNewBranch('');
        }}
      >
        <Input
          autoFocus
          placeholder="feature/my-change"
          value={newBranch}
          onChange={(event) => setNewBranch(event.target.value)}
          onPressEnter={() => void create()}
        />
      </Modal>
    </>
  );
}

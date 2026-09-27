import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Popconfirm, App } from 'antd';
import {
  EditOutlined,
  MergeCellsOutlined,
  BranchesOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';
import { EmptyState, PanelHeader, StatusBadge } from './ui';

interface Props {
  repoId: string;
  onRefresh: () => void;
}

export function BranchesView({ repoId, onRefresh }: Props) {
  const { message } = App.useApp();
  const { branches, fetchBranches } = useRepositoryStore();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const localBranches = useMemo(
    () => branches.filter((branch: any) => !branch.isRemote),
    [branches],
  );
  const remoteBranches = useMemo(
    () => branches.filter((branch: any) => branch.isRemote),
    [branches],
  );

  useEffect(() => {
    void fetchBranches(repoId);
  }, [repoId, fetchBranches]);

  const refresh = async () => {
    await fetchBranches(repoId);
    onRefresh();
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setLoading(true);
    try {
      await gitApi.createBranch(repoId, newBranchName.trim(), true);
      message.success(`分支“${newBranchName.trim()}”已创建并切换`);
      setCreateModalVisible(false);
      setNewBranchName('');
      await refresh();
    } catch (err: any) {
      message.error(err.message || '无法创建分支');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.switchBranch(repoId, name);
      message.success(`已切换到“${name}”`);
      await refresh();
    } catch (err: any) {
      message.error(err.message || '无法切换分支');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.deleteBranch(repoId, name);
      message.success(`分支“${name}”已删除`);
      await refresh();
    } catch (err: any) {
      message.error(err.message || '无法删除分支');
    } finally {
      setLoading(false);
    }
  };

  const renameBranch = async () => {
    if (!renaming || !rename.trim()) return;
    setLoading(true);
    try {
      await gitApi.renameBranch(repoId, renaming, rename.trim());
      setRenaming(null);
      await refresh();
      message.success('分支已重命名');
    } catch (error: any) {
      message.error(error.message);
    } finally {
      setLoading(false);
    }
  };
  const mergeBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.merge(repoId, name);
      message.success('合并完成');
    } catch (error: any) {
      message.error(error.message);
    } finally {
      await refresh();
      setLoading(false);
    }
  };

  const renderBranch = (branch: any) => (
    <div className="branch-row" key={`${branch.isRemote}-${branch.name}`}>
      <div className="branch-row__main">
        <BranchesOutlined className={branch.isCurrent ? 'branch-icon--current' : undefined} />
        <span className="branch-row__name" title={branch.name}>
          {branch.name}
        </span>
        {branch.isCurrent && <StatusBadge status="connected" label="当前" />}
        {branch.upstream && <span className="branch-row__meta">↔ {branch.upstream}</span>}
      </div>
      <div className="branch-row__actions">
        {!branch.isCurrent && (
          <Popconfirm
            title={`将“${branch.name}”合并到当前分支？`}
            description="合并可能产生冲突，请先保存当前改动。"
            onConfirm={() => mergeBranch(branch.name)}
          >
            <Button size="small" disabled={loading} icon={<MergeCellsOutlined />}>
              合并
            </Button>
          </Popconfirm>
        )}
        {!branch.isRemote && (
          <Button
            size="small"
            disabled={loading}
            aria-label={`重命名 ${branch.name}`}
            icon={<EditOutlined />}
            onClick={() => {
              setRenaming(branch.name);
              setRename(branch.name);
            }}
          >
            重命名
          </Button>
        )}
        {!branch.isCurrent && !branch.isRemote && (
          <Button
            size="small"
            icon={<SwapOutlined />}
            loading={loading}
            onClick={() => void handleSwitchBranch(branch.name)}
          >
            切换
          </Button>
        )}
        {!branch.isCurrent && !branch.isRemote && (
          <Popconfirm
            title={`删除“${branch.name}”？`}
            description="仅删除已合并的分支；Git 会保护未合并的提交。"
            onConfirm={() => void handleDeleteBranch(branch.name)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`删除 ${branch.name}`}
            />
          </Popconfirm>
        )}
      </div>
    </div>
  );

  return (
    <section className="workspace-panel">
      <PanelHeader
        title="分支"
        count={branches.length}
        description="此仓库的本地和远程引用"
        icon={<BranchesOutlined />}
        extra={
          <>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              aria-label="刷新分支"
              onClick={() => void refresh()}
              loading={loading}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              新建分支
            </Button>
          </>
        }
      />
      {branches.length === 0 ? (
        <EmptyState
          title="未找到分支"
          description="首次提交后会显示当前分支，也可以刷新仓库引用。"
        />
      ) : (
        <div className="branch-list">
          <div className="branch-section">
            <div className="branch-section__title">本地 · {localBranches.length}</div>
            {localBranches.map(renderBranch)}
          </div>
          {remoteBranches.length > 0 && (
            <div className="branch-section">
              <div className="branch-section__title">远程 · {remoteBranches.length}</div>
              {remoteBranches.map(renderBranch)}
            </div>
          )}
        </div>
      )}
      <Modal
        title={`重命名分支 ${renaming || ''}`}
        open={renaming !== null}
        onCancel={() => setRenaming(null)}
        onOk={() => void renameBranch()}
        confirmLoading={loading}
        okText="重命名"
        okButtonProps={{ disabled: !rename.trim() || rename === renaming }}
      >
        <Input
          aria-label="新的分支名称"
          value={rename}
          onChange={(event) => setRename(event.target.value)}
          onPressEnter={() => void renameBranch()}
        />
      </Modal>
      <Modal
        title="新建分支"
        open={createModalVisible}
        onOk={() => void handleCreateBranch()}
        onCancel={() => setCreateModalVisible(false)}
        confirmLoading={loading}
        okText="创建并切换"
      >
        <Input
          autoFocus
          placeholder="feature/my-change"
          value={newBranchName}
          onChange={(event) => setNewBranchName(event.target.value)}
          onPressEnter={() => void handleCreateBranch()}
        />
      </Modal>
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Popconfirm, message } from 'antd';
import { BranchesOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { gitApi } from '../api';
import { EmptyState, PanelHeader, StatusBadge } from './ui';

interface Props {
  repoId: string;
  onRefresh: () => void;
}

export function BranchesView({ repoId, onRefresh }: Props) {
  const { branches, fetchBranches } = useRepositoryStore();
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [loading, setLoading] = useState(false);
  const localBranches = useMemo(() => branches.filter((branch: any) => !branch.isRemote), [branches]);
  const remoteBranches = useMemo(() => branches.filter((branch: any) => branch.isRemote), [branches]);

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
      message.success(`Branch “${newBranchName.trim()}” created and checked out`);
      setCreateModalVisible(false);
      setNewBranchName('');
      await refresh();
    } catch (err: any) {
      message.error(err.message || 'Unable to create branch');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.switchBranch(repoId, name);
      message.success(`Switched to “${name}”`);
      await refresh();
    } catch (err: any) {
      message.error(err.message || 'Unable to switch branch');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.deleteBranch(repoId, name);
      message.success(`Branch “${name}” deleted`);
      await refresh();
    } catch (err: any) {
      message.error(err.message || 'Unable to delete branch');
    } finally {
      setLoading(false);
    }
  };

  const renderBranch = (branch: any) => (
    <div className="branch-row" key={`${branch.isRemote}-${branch.name}`}>
      <div className="branch-row__main">
        <BranchesOutlined className={branch.isCurrent ? 'branch-icon--current' : undefined} />
        <span className="branch-row__name" title={branch.name}>{branch.name}</span>
        {branch.isCurrent && <StatusBadge status="connected" label="Current" />}
        {branch.upstream && <span className="branch-row__meta">↔ {branch.upstream}</span>}
      </div>
      <div className="branch-row__actions">
        {!branch.isCurrent && !branch.isRemote && <Button size="small" icon={<SwapOutlined />} loading={loading} onClick={() => void handleSwitchBranch(branch.name)}>Switch</Button>}
        {!branch.isCurrent && !branch.isRemote && <Popconfirm title={`Delete “${branch.name}”?`} description="Unmerged changes may be lost." onConfirm={() => void handleDeleteBranch(branch.name)}><Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${branch.name}`} /></Popconfirm>}
      </div>
    </div>
  );

  return (
    <section className="workspace-panel">
      <PanelHeader title="Branches" count={branches.length} description="Local and remote refs for this repository" icon={<BranchesOutlined />} extra={<><Button type="text" icon={<ReloadOutlined />} aria-label="Refresh branches" onClick={() => void refresh()} loading={loading}>Refresh</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalVisible(true)}>New branch</Button></>} />
      {branches.length === 0 ? <EmptyState title="No branches found" description="Refresh after connecting to inspect the repository refs." /> : <div className="branch-list">
        <div className="branch-section"><div className="branch-section__title">Local · {localBranches.length}</div>{localBranches.map(renderBranch)}</div>
        {remoteBranches.length > 0 && <div className="branch-section"><div className="branch-section__title">Remote · {remoteBranches.length}</div>{remoteBranches.map(renderBranch)}</div>}
      </div>}
      <Modal title="Create branch" open={createModalVisible} onOk={() => void handleCreateBranch()} onCancel={() => setCreateModalVisible(false)} confirmLoading={loading} okText="Create and switch">
        <Input autoFocus placeholder="feature/my-change" value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} onPressEnter={() => void handleCreateBranch()} />
      </Modal>
    </section>
  );
}

import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useMemo, useState } from 'react';
import { Button, Input } from '@alune/ui';
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
import { useBranchSwitch } from '../hooks/useBranchSwitch';
import { ErrorState, EmptyState, PanelHeader, StatusBadge } from '@alune/ui';
import { AluneModal } from '@alune/ui';
import { AlunePopconfirm } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { TagsView } from './TagsView';

function useBranchDialogContext(repoId: string) {
  const branches = useRepositoryStore((state) => state.branches);
  const repoName = useRepositoryStore((state) =>
    state.currentRepo?.id === repoId
      ? state.currentRepo?.name
      : state.repositories.find((repo: any) => repo.id === repoId)?.name,
  );
  const localNames = useMemo(
    () => new Set<string>(branches.filter((b: any) => !b.isRemote).map((b: any) => b.name)),
    [branches],
  );
  const current: string | undefined = branches.find((b: any) => !b.isRemote && b.isCurrent)?.name;
  return { repoName: repoName as string | undefined, localNames, current };
}

/** F04 new branch dialog, shared by the branch view and the toolbar branch picker. */
export function NewBranchDialog({
  open,
  repoId,
  value,
  busy,
  onChange,
  onCreate,
  onCancel,
}: {
  open: boolean;
  repoId: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCreate: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const { repoName, localNames, current } = useBranchDialogContext(repoId);
  const name = value.trim();
  const taken = name !== '' && localNames.has(name);
  return (
    <AluneModal
      open={open}
      size="sm"
      glyph="branch"
      eyebrow={{ label: '分支', detail: repoName }}
      title="新建分支"
      okText="创建并切换"
      busyText="正在创建…"
      okDisabled={!name || taken}
      confirmLoading={busy}
      onOk={onCreate}
      onCancel={onCancel}
    >
      <label className="dlg-fld">
        <span className="dlg-fld-label">分支名称</span>
        <Input
          className="dlg-mono-input"
          prefix={<DialogIcon name="branch" />}
          placeholder="feature/my-change"
          value={value}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          aria-invalid={taken || undefined}
          status={taken ? 'error' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {taken ? (
          <span className="dlg-fld-hint is-error" role="status">
            <DialogIcon name="warning" />
            已存在同名本地分支
          </span>
        ) : (
          <span className="dlg-fld-hint">
            {current ? (
              <>
                从当前分支 <code>{current}</code> 创建，并立即切换
              </>
            ) : (
              '从当前 HEAD 创建，并立即切换'
            )}
          </span>
        )}
      </label>
    </AluneModal>
  );
}

interface Props {
  repoId: string;
  onRefresh: () => void;
  refreshToken?: number;
}

export function BranchesView({ repoId, onRefresh, refreshToken }: Props) {
  const message = useFeedbackMessage();
  const { branches, fetchBranches, error, errorPanel } = useRepositoryStore();
  // P02 reads the working tree so the merge prompt states the real number of changes.
  const changedFiles = useRepositoryStore(
    (state) => state.repositoryStatuses[repoId]?.data?.files.length ?? null,
  );
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [mutating, setLoading] = useState(false);
  const { switching, switchBranch: handleSwitchBranch } = useBranchSwitch(repoId, onRefresh);
  const loading = mutating || switching !== null;
  // The source name outlives the open flag so the title stays put while the dialog fades out.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [rename, setRename] = useState('');
  const { repoName, localNames } = useBranchDialogContext(repoId);
  const renameValue = rename.trim();
  const renameTaken = renameValue !== renaming && localNames.has(renameValue);
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
      setCreateModalVisible(false);
      setNewBranchName('');
      await refresh();
    } catch (err: any) {
      message.error(err.message || '无法创建分支');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBranch = async (name: string) => {
    setLoading(true);
    try {
      await gitApi.deleteBranch(repoId, name);
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
      setRenameOpen(false);
      await refresh();
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
    } catch (error: any) {
      message.error(error.message);
    } finally {
      await refresh();
      setLoading(false);
    }
  };

  const currentName = localBranches.find((branch: any) => branch.isCurrent)?.name as
    | string
    | undefined;
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
          <AlunePopconfirm
            tone="safe"
            icon="merge"
            title={`将“${branch.name}”合并到 ${currentName ?? '当前分支'}？`}
            description="如有冲突，会停在冲突状态，可以随时中止。"
            extra={
              changedFiles === null ? undefined : (
                <span className="dlg-badges">
                  {changedFiles === 0 ? (
                    <span className="dlg-badge" data-tone="success">
                      工作区干净
                    </span>
                  ) : (
                    <span className="dlg-badge" data-tone="warning">
                      {changedFiles} 项未提交改动
                    </span>
                  )}
                </span>
              )
            }
            hint={changedFiles ? '建议先储藏或提交当前改动。' : undefined}
            okText="合并"
            disabled={loading}
            onConfirm={() => mergeBranch(branch.name)}
          >
            <Button size="small" disabled={loading} icon={<MergeCellsOutlined />}>
              合并
            </Button>
          </AlunePopconfirm>
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
              setRenameOpen(true);
            }}
          >
            重命名
          </Button>
        )}
        {!branch.isCurrent && (
          <Button
            size="small"
            icon={<SwapOutlined />}
            loading={switching === branch.name}
            disabled={loading}
            aria-label={`切换到 ${branch.name}`}
            onClick={() => void handleSwitchBranch(branch.name, branch.isRemote)}
          >
            切换
          </Button>
        )}
        {!branch.isCurrent && !branch.isRemote && (
          <AlunePopconfirm
            icon="branch"
            title={`删除“${branch.name}”？`}
            description="只删除已合并的分支；含未合并提交时 Git 会拒绝删除。"
            okText="删除分支"
            disabled={loading}
            onConfirm={() => handleDeleteBranch(branch.name)}
          >
            <Button
              size="small"
              danger
              disabled={loading}
              icon={<DeleteOutlined />}
              aria-label={`删除 ${branch.name}`}
            />
          </AlunePopconfirm>
        )}
      </div>
    </div>
  );

  return (
    <section className="workspace-panel">
      <PanelHeader
        title="分支与标签"
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
      <div className="branch-list">
        {error && errorPanel === 'branches' && !branches.length ? (
          <ErrorState
            title="无法读取分支"
            description={error}
            onRetry={() => void fetchBranches(repoId)}
          />
        ) : branches.length === 0 ? (
          <EmptyState
            title="未找到分支"
            description="首次提交后会显示当前分支，也可以刷新仓库引用。"
          />
        ) : (
          <>
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
          </>
        )}
        <TagsView repoId={repoId} onRefresh={onRefresh} refreshToken={refreshToken} />
      </div>
      <AluneModal
        open={renameOpen}
        size="sm"
        glyph="branch"
        eyebrow={{ label: '分支', detail: repoName }}
        title={
          <>
            重命名分支 <code>{renaming}</code>
          </>
        }
        okText="重命名"
        busyText="正在重命名…"
        okDisabled={!renameValue || renameValue === renaming || renameTaken}
        confirmLoading={loading}
        onOk={renameBranch}
        onCancel={() => setRenameOpen(false)}
        afterClose={() => setRenaming(null)}
      >
        <label className="dlg-fld">
          <span className="dlg-fld-label">新名称</span>
          <Input
            aria-label="新的分支名称"
            className="dlg-mono-input"
            prefix={<DialogIcon name="pencil" />}
            value={rename}
            autoComplete="off"
            spellCheck={false}
            data-autofocus
            aria-invalid={renameTaken || undefined}
            status={renameTaken ? 'error' : undefined}
            onChange={(event) => setRename(event.target.value)}
          />
          {!renameValue ? (
            <span className="dlg-fld-hint is-error" role="status">
              <DialogIcon name="warning" />
              请输入分支名称
            </span>
          ) : renameValue === renaming ? (
            <span className="dlg-fld-hint">名称未变化</span>
          ) : renameTaken ? (
            <span className="dlg-fld-hint is-error" role="status">
              <DialogIcon name="warning" />
              已存在同名本地分支
            </span>
          ) : (
            <span className="dlg-fld-hint is-ok">
              <DialogIcon name="check" />
              名称未被占用，跟踪关系保持不变
            </span>
          )}
        </label>
      </AluneModal>
      <NewBranchDialog
        open={createModalVisible}
        repoId={repoId}
        value={newBranchName}
        busy={loading}
        onChange={setNewBranchName}
        onCreate={handleCreateBranch}
        onCancel={() => setCreateModalVisible(false)}
      />
    </section>
  );
}

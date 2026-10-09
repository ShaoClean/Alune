import { useCallback, useEffect, useRef, useState } from 'react';
import { AluneModal, Button, Input, Select, useFeedbackMessage } from '@alune/ui';
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  TagOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { GitTag, RemoteTag } from '@alune/shared';
import { gitApi } from '../api';
import { useRepositoryStore, useWorkspaceData } from '../stores/repositoryStore';
import { CreateTagDialog } from './CreateTagDialog';

export function TagsView({
  repoId,
  onRefresh,
  refreshToken,
}: {
  repoId: string;
  onRefresh: () => void;
  refreshToken?: number;
}) {
  const feedback = useFeedbackMessage();
  const [tags, setTags] = useState<GitTag[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [remote, setRemote] = useState('');
  const [remoteTags, setRemoteTags] = useState<RemoteTag[] | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [create, setCreate] = useState(false);
  const [deleting, setDeleting] = useState<GitTag | null>(null);
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [checkout, setCheckout] = useState<GitTag | null>(null);
  const [checkoutMode, setCheckoutMode] = useState('branch');
  const [branch, setBranch] = useState('');
  const [pushAll, setPushAll] = useState(false);
  const remotes = useWorkspaceData(repoId, (workspace) => workspace.remotes);
  const remoteRequest = useRef(0);
  const listRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const next = await gitApi.tags(repoId);
      if (request === listRequest.current) {
        setTags(next);
        setError('');
      }
    } catch (error: any) {
      if (request === listRequest.current) setError(error.message);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [repoId]);
  const loadRemote = useCallback(async () => {
    const request = ++remoteRequest.current;
    setRemoteTags(null);
    setRemoteError('');
    if (!remote) {
      setRemoteBusy(false);
      return;
    }
    setRemoteBusy(true);
    try {
      const next = await gitApi.remoteTags(repoId, remote);
      if (request === remoteRequest.current) setRemoteTags(next);
    } catch (error: any) {
      if (request === remoteRequest.current) setRemoteError(error.message);
    } finally {
      if (request === remoteRequest.current) setRemoteBusy(false);
    }
  }, [repoId, remote]);
  useEffect(() => {
    void load();
    void useRepositoryStore.getState().fetchRemotes(repoId);
    return () => {
      listRequest.current++;
    };
  }, [repoId, load, refreshToken]);
  useEffect(() => {
    setRemote((current) =>
      remotes.some((item) => item.name === current)
        ? current
        : (remotes.find((item) => item.name === 'origin')?.name ?? remotes[0]?.name ?? ''),
    );
  }, [remotes]);
  useEffect(() => {
    void loadRemote();
    return () => {
      remoteRequest.current++;
    };
  }, [loadRemote, refreshToken]);

  const run = async (action: () => Promise<unknown>, success: string, close?: () => void) => {
    setBusy(true);
    try {
      await action();
      feedback.success(success);
      close?.();
    } catch (error: any) {
      feedback.error(error.message || '标签操作失败');
    } finally {
      await Promise.all([load(), useRepositoryStore.getState().fetchLog(repoId)]);
      // Remote reads must not keep local actions busy while offline.
      if (refreshToken === undefined) void loadRemote();
      onRefresh();
      setBusy(false);
    }
  };
  const selectedRemoteTag = deleting && remoteTags?.find((tag) => tag.name === deleting.name);
  const filtered = tags.filter((tag) =>
    `${tag.name} ${tag.commitHash ?? tag.objectHash} ${tag.message}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <section className="tag-section" aria-label="标签管理">
      <div className="tag-section__heading">
        <h3>
          <TagOutlined /> 标签 <span>{tags.length}</span>
        </h3>
        <div className="tag-actions">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading || remoteBusy}
            disabled={busy}
            onClick={() => {
              void load();
              void loadRemote();
            }}
          >
            刷新标签
          </Button>
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={busy}
            onClick={() => setCreate(true)}
          >
            创建标签
          </Button>
        </div>
      </div>
      <div className="tag-controls">
        <Input
          aria-label="搜索标签"
          placeholder="搜索标签、提交或附注"
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="标签远程"
          placeholder="暂无远程"
          value={remote || undefined}
          disabled={busy || !!deleting || !!checkout || pushAll}
          options={remotes.map((item) => ({ label: item.name, value: item.name }))}
          onChange={setRemote}
        />
        <Button
          size="small"
          icon={<UploadOutlined />}
          disabled={busy || !remote || !tags.length || !!error}
          onClick={() => setPushAll(true)}
        >
          推送全部标签
        </Button>
      </div>
      {error && (
        <div className="tag-error" role="alert">
          {error}
          <Button type="link" onClick={() => void load()}>
            重试
          </Button>
        </div>
      )}
      {remoteError && (
        <div className="tag-error" role="status">
          远程状态未知：{remoteError}
          <Button type="link" onClick={() => void loadRemote()}>
            重试
          </Button>
        </div>
      )}
      {!remote && <p className="tag-hint">配置远程后可推送标签和查看远程状态。</p>}
      {!filtered.length && !error && (
        <p className="tag-hint">
          {loading
            ? '正在读取标签…'
            : search
              ? '没有匹配的标签'
              : '尚无标签，可从当前 HEAD 或提交详情创建。'}
        </p>
      )}
      {filtered.map((tag) => {
        const remoteTag = remoteTags?.find((item) => item.name === tag.name);
        const state = !remote
          ? '无远程'
          : remoteBusy
            ? '查询中…'
            : !remoteTags
              ? '远程状态未知'
              : !remoteTag
                ? '未推送'
                : remoteTag.objectHash === tag.objectHash
                  ? '远程已存在'
                  : '远程同名标签不同';
        return (
          <article className="branch-row tag-row" key={tag.name}>
            <div className="tag-row__body">
              <div className="tag-row__title">
                <TagOutlined />
                <strong>{tag.name}</strong>
                <span>{tag.type === 'annotated' ? '附注' : '轻量'}</span>
              </div>
              <div className="tag-row__meta">
                <code title={tag.commitHash ?? tag.objectHash}>
                  {(tag.commitHash ?? tag.objectHash).slice(0, 12)}
                </code>
                <span>{tag.commitHash ? '提交' : `非提交对象 · ${tag.objectType}`}</span>
                <span>{state}</span>
              </div>
              {tag.message && (
                <details>
                  <summary title={tag.message.split('\n')[0]}>{tag.message.split('\n')[0]}</summary>
                  <pre>{tag.message}</pre>
                  {tag.tagger && <span className="tag-hint">附注作者：{tag.tagger}</span>}
                </details>
              )}
            </div>
            <div className="tag-actions">
              <Button
                size="small"
                disabled={busy || !tag.commitHash || !!error}
                onClick={() => {
                  setCheckout(tag);
                  setCheckoutMode('branch');
                  setBranch('');
                }}
              >
                检出
              </Button>
              <Button
                size="small"
                disabled={busy || !remote || !!error}
                onClick={() =>
                  void run(
                    () => gitApi.pushTag(repoId, { remote, name: tag.name }),
                    `已推送标签 ${tag.name}`,
                  )
                }
              >
                推送
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={`删除标签 ${tag.name}`}
                disabled={busy || !!error}
                onClick={() => {
                  setDeleting(tag);
                  setDeleteRemote(false);
                }}
              />
            </div>
          </article>
        );
      })}
      {create && (
        <CreateTagDialog
          repoId={repoId}
          onCancel={() => setCreate(false)}
          onCreated={() => {
            setCreate(false);
            void load();
            onRefresh();
          }}
        />
      )}
      <AluneModal
        open={!!deleting}
        level={1}
        glyph={<TagOutlined />}
        title={`删除标签“${deleting?.name ?? ''}”？`}
        description="删除本地标签不会删除提交。此仓库的所有 Worktree 共享标签。"
        okText={deleteRemote ? '删除本地与远程标签' : '删除本地标签'}
        confirmLoading={busy}
        okDisabled={deleteRemote && !selectedRemoteTag}
        onCancel={() => setDeleting(null)}
        onOk={() =>
          deleting &&
          run(
            () =>
              gitApi.deleteTag(repoId, {
                name: deleting.name,
                objectHash: deleting.objectHash,
                confirmed: true,
                ...(deleteRemote && selectedRemoteTag
                  ? { remote, remoteObjectHash: selectedRemoteTag.objectHash }
                  : {}),
              }),
            '标签已删除',
            () => setDeleting(null),
          )
        }
      >
        {remote && (
          <label className="tag-checkbox">
            <input
              type="checkbox"
              checked={deleteRemote}
              disabled={!selectedRemoteTag || busy}
              onChange={(event) => setDeleteRemote(event.target.checked)}
            />
            同时删除 {remote} 上的同名标签
          </label>
        )}
        {remote && !remoteTags && (
          <p className="tag-hint">远程状态未知，请刷新标签后再选择删除远程标签。</p>
        )}
        {selectedRemoteTag && selectedRemoteTag.objectHash !== deleting?.objectHash && (
          <p className="tag-error">远程同名标签指向不同对象。勾选后也会删除该远程标签。</p>
        )}
      </AluneModal>
      <AluneModal
        open={!!checkout}
        glyph={<TagOutlined />}
        title={`从“${checkout?.name ?? ''}”检出`}
        okText={checkoutMode === 'branch' ? '创建分支并切换' : '确认进入游离 HEAD'}
        confirmLoading={busy}
        okDisabled={checkoutMode === 'branch' && !branch.trim()}
        onCancel={() => setCheckout(null)}
        onOk={() =>
          checkout &&
          run(
            () =>
              gitApi.checkoutTag(repoId, {
                name: checkout.name,
                objectHash: checkout.objectHash,
                ...(checkoutMode === 'branch' ? { branch: branch.trim() } : { confirmed: true }),
              }),
            '已从标签检出',
            () => setCheckout(null),
          )
        }
      >
        <div className="dlg-fld">
          <Select
            aria-label="标签检出方式"
            value={checkoutMode}
            onChange={setCheckoutMode}
            options={[
              { label: '创建新分支（推荐）', value: 'branch' },
              { label: '直接检出 · 游离 HEAD', value: 'detached' },
            ]}
          />
        </div>
        {checkoutMode === 'branch' ? (
          <label className="dlg-fld">
            <span className="dlg-fld-label">新分支名称</span>
            <Input
              aria-label="从标签创建的分支名称"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="release/fix"
            />
          </label>
        ) : (
          <p className="tag-error">
            游离 HEAD 不属于任何分支。如果继续提交，请在离开前创建分支保留新提交。
          </p>
        )}
      </AluneModal>
      <AluneModal
        open={pushAll}
        glyph={<UploadOutlined />}
        title={`推送全部 ${tags.length} 个标签？`}
        description={`将所有本地标签推送到 ${remote}；远程同名标签不同会被拒绝。`}
        okText="推送全部标签"
        confirmLoading={busy}
        onCancel={() => setPushAll(false)}
        onOk={() =>
          run(
            () => gitApi.pushTag(repoId, { remote, all: true }),
            '全部标签已推送',
            () => setPushAll(false),
          )
        }
      />
    </section>
  );
}

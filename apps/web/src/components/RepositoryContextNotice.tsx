import { useEffect, useState } from 'react';
import { Alert, App, Input, Modal } from 'antd';
import { FeedbackNotice } from './Feedback';
import type { RepositoryContext } from '@alune/shared';
import { gitApi, repositoryApi } from '../api';

export function RepositoryContextNotice({
  repoId,
  revision,
  onContext,
  onRemotes,
  onRefresh,
}: {
  repoId: string;
  revision: string;
  onContext: (context: RepositoryContext) => void;
  onRemotes: () => void;
  onRefresh: () => void;
}) {
  const { message } = App.useApp();
  const [context, setContext] = useState<RepositoryContext | null>(null);
  const [error, setError] = useState('');
  const [authorError, setAuthorError] = useState('');
  const [deepenError, setDeepenError] = useState('');
  const [contextLoading, setContextLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setContextLoading(true);
    void repositoryApi
      .context(repoId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setContext(value);
        onContext(value);
        setError('');
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setContextLoading(false);
      });
    return () => controller.abort();
  }, [repoId, revision, retry, onContext]);
  const save = async () => {
    setBusy(true);
    setAuthorError('');
    try {
      await gitApi.saveAuthor(repoId, name.trim(), email.trim());
      setAuthorOpen(false);
      setRetry((value) => value + 1);
      onRefresh();
      message.success('此仓库的提交作者已保存');
    } catch (failure: any) {
      setAuthorError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const deepen = async () => {
    setBusy(true);
    setDeepenError('');
    try {
      await gitApi.deepen(repoId, context?.remotes[0]?.name);
      setRetry((value) => value + 1);
      onRefresh();
    } catch (failure: any) {
      setDeepenError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <FeedbackNotice
        source="repository-context"
        title={error ? '无法读取仓库配置' : null}
        description={error}
        busy={contextLoading}
        mode="notification"
        actionLabel="重试"
        onAction={() => setRetry((value) => value + 1)}
      />
      <FeedbackNotice
        source="unborn"
        title={context?.unborn ? '尚无提交' : null}
        type="info"
        mode="manual"
        description="先暂存文件，再创建首次提交。"
      />
      <FeedbackNotice
        source="no-remote"
        title={context && !context.remotes.length ? '未配置远程' : null}
        type="info"
        mode="manual"
        description="可以继续本地提交。配置远程后可获取、拉取和推送。"
        actionLabel="添加远程"
        onAction={onRemotes}
      />
      <FeedbackNotice
        source="no-author"
        title={
          context && (!context.author.name || !context.author.email) ? '提交前需要设置作者' : null
        }
        type="warning"
        mode="manual"
        actionLabel="设置作者"
        onAction={() => {
          setName(context!.author.name);
          setEmail(context!.author.email);
          setAuthorError('');
          setAuthorOpen(true);
        }}
      />
      <FeedbackNotice
        source="shallow"
        title={context?.shallow ? '浅克隆仅显示已获取的历史' : null}
        type="info"
        mode="manual"
        actionLabel={context?.remotes.length ? '获取完整历史' : undefined}
        busy={busy}
        onAction={deepen}
      />
      <FeedbackNotice
        source="deepen-error"
        title={deepenError ? '获取完整历史未完成' : null}
        description={deepenError}
        busy={busy}
        actionLabel="重试"
        onAction={deepen}
      />
      <Modal
        title="设置提交作者"
        open={authorOpen}
        onCancel={() => setAuthorOpen(false)}
        onOk={() => void save()}
        confirmLoading={busy}
        okButtonProps={{ disabled: !name.trim() || !email.trim() }}
        okText="保存到此仓库"
      >
        {authorError && <Alert type="error" title={authorError} />}
        <p className="modal-description">仅写入此仓库的 Git 配置，不修改系统全局配置。</p>
        <label className="git-form-label" htmlFor="git-author-name">
          姓名
        </label>
        <Input
          id="git-author-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="git-form-label" htmlFor="git-author-email">
          邮箱
        </label>
        <Input
          id="git-author-email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Modal>
    </>
  );
}

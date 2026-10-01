import { useFeedbackMessage } from '@alune/ui';
import { useEffect, useState } from 'react';
import { Input } from '@alune/ui';
import { FeedbackNotice } from '@alune/ui';
import type { RepositoryContext } from '@alune/shared';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { AluneModal } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogNote } from '@alune/ui';

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
  const message = useFeedbackMessage();
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
  const repoName = useRepositoryStore(
    (state) => state.repositories.find((repo) => repo.id === repoId)?.name,
  );
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
        icon="globe"
        actionIcon="plus"
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
        icon="user"
        actionIcon="arrow-right"
        description="user.name 和 user.email 未完整配置，提交可能失败或使用 Git 自动推断的身份。设置只写入此仓库的本地 Git 配置，不影响全局配置。"
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
        icon="commit"
        actionIcon="cloud-down"
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
      <AluneModal
        open={authorOpen}
        size="sm"
        glyph="user"
        eyebrow={{ label: '提交', detail: repoName }}
        title="设置提交作者"
        description="只写入此仓库的本地 Git 配置，不修改系统全局配置。"
        hintVerb="保存"
        onCancel={() => setAuthorOpen(false)}
        onOk={save}
        confirmLoading={busy}
        okDisabled={!name.trim() || !email.trim()}
        okText="保存到此仓库"
        busyText="正在保存…"
      >
        {authorError && (
          <DialogNote tone="danger" role="alert" title="作者未保存">
            {authorError}
          </DialogNote>
        )}
        <label className="dlg-fld" htmlFor="git-author-name">
          <span className="dlg-fld-label">姓名</span>
          <Input
            id="git-author-name"
            data-autofocus
            value={name}
            autoComplete="name"
            prefix={<DialogIcon name="user" />}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="dlg-fld" htmlFor="git-author-email">
          <span className="dlg-fld-label">邮箱</span>
          <Input
            id="git-author-email"
            className="dlg-mono-input"
            type="email"
            value={email}
            placeholder="you@example.com"
            autoComplete="email"
            spellCheck={false}
            prefix={<DialogIcon name="mail" />}
            onChange={(event) => setEmail(event.target.value)}
          />
          {name.trim() && email.trim() ? (
            <span className="dlg-fld-hint is-ok">
              <DialogIcon name="check" />
              将以 <code>git config --local</code> 写入 <code>user.name</code> 和{' '}
              <code>user.email</code>
            </span>
          ) : (
            <span className="dlg-fld-hint">
              填写后，提交记录会显示为{' '}
              <code>
                {name.trim() || '姓名'} &lt;{email.trim() || '邮箱'}&gt;
              </code>
            </span>
          )}
        </label>
      </AluneModal>
    </>
  );
}

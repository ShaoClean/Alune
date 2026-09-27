import { useEffect, useState } from 'react';
import { Alert, App, Button, Input, Modal } from 'antd';
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
  const [retry, setRetry] = useState(0);
  const [authorOpen, setAuthorOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
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
      });
    return () => controller.abort();
  }, [repoId, revision, retry, onContext]);
  const save = async () => {
    setBusy(true);
    try {
      await gitApi.saveAuthor(repoId, name.trim(), email.trim());
      setAuthorOpen(false);
      setRetry((value) => value + 1);
      onRefresh();
      message.success('此仓库的提交作者已保存');
    } catch (failure: any) {
      message.error(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const deepen = async () => {
    setBusy(true);
    try {
      await gitApi.deepen(repoId, context?.remotes[0]?.name);
      setRetry((value) => value + 1);
      onRefresh();
    } catch (failure: any) {
      message.error(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <Alert
          type="warning"
          title="无法读取仓库配置"
          description={error}
          action={
            <Button size="small" onClick={() => setRetry((value) => value + 1)}>
              重试
            </Button>
          }
        />
      )}
      {context && (
        <div className="repository-context-notices">
          {context.unborn && <div role="status">尚无提交。先暂存文件，再创建首次提交。</div>}
          {!context.remotes.length && (
            <div>
              未配置远程。可以继续提交。
              <Button type="link" size="small" onClick={onRemotes}>
                添加远程
              </Button>
            </div>
          )}
          {(!context.author.name || !context.author.email) && (
            <div>
              提交前需要设置作者。
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setName(context.author.name);
                  setEmail(context.author.email);
                  setAuthorOpen(true);
                }}
              >
                设置作者
              </Button>
            </div>
          )}
          {context.shallow && (
            <div>
              浅克隆仅显示已获取的历史。
              <Button
                type="link"
                size="small"
                disabled={!context.remotes.length || busy}
                onClick={() => void deepen()}
              >
                获取完整历史
              </Button>
            </div>
          )}
        </div>
      )}
      <Modal
        title="设置提交作者"
        open={authorOpen}
        onCancel={() => setAuthorOpen(false)}
        onOk={() => void save()}
        confirmLoading={busy}
        okButtonProps={{ disabled: !name.trim() || !email.trim() }}
        okText="保存到此仓库"
      >
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

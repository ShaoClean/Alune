import { useEffect, useState } from 'react';
import { AluneModal, Button, DialogNote, Input } from '@alune/ui';
import { gitApi, repositoryApi } from '../api';
import { useRepositoryStore } from '../stores/repositoryStore';

export function AmendCommitDialog({
  repoId,
  onClose,
  onCommitted,
}: {
  repoId: string;
  onClose: () => void;
  onCommitted: () => void | Promise<void>;
}) {
  const [head, setHead] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHead('');
    setError('');
    repositoryApi
      .log(repoId, { count: 1, branch: 'HEAD' }, controller.signal)
      .then(async (page) => {
        if (!page.commits[0]) throw new Error('此仓库尚无可修改的提交。');
        const commit = await repositoryApi.blameCommit(
          repoId,
          page.commits[0].hash,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setHead(commit.hash);
          setMessage(commit.body);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [repoId, attempt]);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await gitApi.commit(repoId, message, undefined, head);
      await Promise.all([onCommitted(), useRepositoryStore.getState().fetchLog(repoId)]);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AluneModal
      open
      size="sm"
      title="修改上一次提交"
      okText="确认修改提交"
      onCancel={onClose}
      onOk={save}
      confirmLoading={busy}
      okDisabled={!head || !message.trim()}
    >
      <DialogNote tone="warning" title="这会改写提交历史">
        将当前已暂存内容并入 HEAD，并替换提交信息；已推送的提交需要与协作者协调。
        新提交遵循当前签名配置，原签名不会保留。{head && <code>{head.slice(0, 12)}</code>}
      </DialogNote>
      {error && (
        <DialogNote tone="danger" role="alert" title="修改未完成">
          {error}
          <Button size="small" disabled={busy} onClick={() => setAttempt((v) => v + 1)}>
            重新读取上一次提交
          </Button>
        </DialogNote>
      )}
      {!head && !error && <p role="status">正在读取上一次提交…</p>}
      <label className="dlg-fld">
        <span className="dlg-fld-label">提交信息</span>
        <Input.TextArea
          aria-label="修改后的提交信息"
          value={message}
          rows={6}
          disabled={!head || busy}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
    </AluneModal>
  );
}

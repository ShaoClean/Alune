import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Spin } from 'antd';
import type {
  PullRequestActions,
  PullRequestCommentPosition,
  PullRequestDetailQuery,
  PullRequestDiscussion,
  PullRequestMergeMethod,
  PullRequestMutation,
} from '@alune/shared';
import { repositoryApi } from '../api';
import { errorMessage } from './files-tree';

interface Draft {
  body: string;
  position?: PullRequestCommentPosition;
  revision: string;
  operationId: string;
}
// Memory only. Keys exclude credentials and prevent one repository's draft reaching another.
const drafts = new Map<string, Draft>();
const emptyDraft = (): Draft => ({ body: '', revision: '', operationId: crypto.randomUUID() });

export function useReviewActions(
  repoId: string,
  query: PullRequestDetailQuery,
  refresh: number,
  onChanged: () => void,
) {
  const identity = JSON.stringify([
    repoId,
    query.remote,
    query.target,
    query.provider,
    query.number,
  ]);
  const [draft, setDraft] = useState<Draft>(() => drafts.get(identity) || emptyDraft());
  const [actions, setActions] = useState<PullRequestActions>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [posted, setPosted] = useState<PullRequestDiscussion[]>([]);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const alive = useRef(true);
  const readSequence = useRef(0);
  const attempt = useRef<{ signature: string; query: PullRequestMutation } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const save = (next: Draft) => {
    drafts.set(identity, next);
    setDraft(next);
  };
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const sequence = ++readSequence.current;
      const current = () => !signal?.aborted && alive.current && sequence === readSequence.current;
      setLoading(true);
      try {
        const next = await repositoryApi.pullRequestActions(repoId, query, signal);
        if (current()) setActions(next);
        return current() ? next : undefined;
      } catch (failure) {
        if (current()) {
          setActions(undefined);
          setError(errorMessage(failure, '无法读取操作权限，请重试。'));
        }
        return undefined;
      } finally {
        if (current()) setLoading(false);
      }
    },
    [repoId, query],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load, refresh]);
  const submit = async (
    action: 'comment' | 'merge' | 'close',
    confirmed?: PullRequestActions,
    method?: PullRequestMergeMethod,
  ) => {
    if (pendingRef.current) return false;
    const capability = confirmed || actions;
    if (!capability?.[action].allowed) return false;
    const payload = {
      ...query,
      action,
      revision: action === 'comment' && draft.position ? draft.revision : capability.revision,
      ...(action === 'comment' ? { body: draft.body, position: draft.position } : {}),
      ...(action === 'merge' ? { method } : {}),
    };
    const signature = JSON.stringify(payload);
    if (attempt.current?.signature !== signature)
      attempt.current = {
        signature,
        query: {
          ...payload,
          operationId: action === 'comment' ? draft.operationId : crypto.randomUUID(),
        },
      };
    pendingRef.current = true;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await repositoryApi.mutatePullRequest(repoId, attempt.current.query);
      if (action === 'comment') {
        if (drafts.get(identity)?.operationId === draft.operationId) drafts.delete(identity);
        if (alive.current && result.discussion)
          setPosted((previous) => [...previous, result.discussion!]);
        if (alive.current) setDraft(emptyDraft());
      }
      if (alive.current) {
        setNotice(
          action === 'comment'
            ? '评论已发表。'
            : action === 'merge'
              ? '已合并。'
              : '已关闭，代码未合入目标分支。',
        );
        onChanged();
      }
      return true;
    } catch (failure) {
      if (alive.current) {
        setError(errorMessage(failure, '提交失败，草稿已保留，请重试。'));
        onChanged();
      }
      return false;
    } finally {
      pendingRef.current = false;
      if (alive.current) setPending(false);
    }
  };
  return {
    actions,
    loading,
    error,
    notice,
    posted,
    pending,
    load,
    submit,
    draft,
    beginConfirmation: () => {
      attempt.current = null;
    },
    updateBody: (body: string) => save({ ...draft, body, operationId: crypto.randomUUID() }),
    select: (position: PullRequestCommentPosition | undefined, revision: string) =>
      save({ ...draft, position, revision, operationId: crypto.randomUUID() }),
  };
}

export type ReviewActions = ReturnType<typeof useReviewActions>;

export function ReviewActionBar({
  review,
  query,
}: {
  review: ReviewActions;
  query: PullRequestDetailQuery;
}) {
  const [confirm, setConfirm] = useState<{
    action: 'merge' | 'close';
    snapshot: PullRequestActions;
  }>();
  const [method, setMethod] = useState<PullRequestMergeMethod>();
  const opening = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const open = async (action: 'merge' | 'close') => {
    if (opening.current || review.pending) return;
    opening.current = true;
    const snapshot = await review.load();
    opening.current = false;
    if (snapshot && mounted.current) {
      // A newly opened confirmation follows a fresh platform read. Retries
      // within the same dialog continue to reuse their original operation ID.
      review.beginConfirmation();
      setMethod(snapshot.mergeMethods[0]?.value);
      setConfirm({ action, snapshot });
    }
  };
  return (
    <section className="pull-request-actions" aria-label="Review 操作">
      <div className="pull-request-actions__buttons">
        <Button
          type="primary"
          disabled={review.loading || review.pending || !review.actions?.merge.allowed}
          onClick={() => void open('merge')}
        >
          合并
        </Button>
        <Button
          danger
          disabled={review.loading || review.pending || !review.actions?.close.allowed}
          onClick={() => void open('close')}
        >
          关闭 PR/MR
        </Button>
        <Button disabled={review.loading || review.pending} onClick={() => void review.load()}>
          刷新操作权限
        </Button>
        {review.loading && <Spin size="small" aria-label="正在检查操作权限" />}
      </div>
      {review.actions?.merge.reason && (
        <p className="pull-request-muted">合并：{review.actions.merge.reason}</p>
      )}
      {review.actions?.close.reason &&
        review.actions.close.reason !== review.actions?.merge.reason && (
          <p className="pull-request-muted">关闭：{review.actions.close.reason}</p>
        )}
      {review.error && <Alert type="error" showIcon title={review.error} />}
      {review.notice && <Alert type="success" showIcon title={review.notice} />}
      <Modal
        open={!!confirm}
        title={confirm?.action === 'merge' ? '确认合并 PR/MR' : '确认关闭 PR/MR'}
        onCancel={() => {
          if (!review.pending) setConfirm(undefined);
        }}
        closable={!review.pending}
        maskClosable={!review.pending}
        cancelButtonProps={{ disabled: review.pending }}
        confirmLoading={review.pending}
        okText={confirm?.action === 'merge' ? '确认合并' : '确认关闭'}
        okButtonProps={{
          danger: confirm?.action === 'close',
          disabled:
            review.loading ||
            !confirm?.snapshot[confirm.action].allowed ||
            (confirm && !review.actions?.[confirm.action].allowed) ||
            (confirm.action === 'merge' && !method),
        }}
        onOk={async () => {
          if (confirm && (await review.submit(confirm.action, confirm.snapshot, method)))
            setConfirm(undefined);
        }}
      >
        {confirm && (
          <>
            <p className="pull-request-confirm-target">
              {query.target} · {query.provider === 'github' ? '#' : '!'}
              {query.number}
            </p>
            <p>
              目标分支：<strong>{confirm.snapshot.targetBranch}</strong>
            </p>
            {confirm.action === 'merge' ? (
              <>
                <label htmlFor="review-merge-method">合并方式</label>
                <Select
                  id="review-merge-method"
                  aria-label="合并方式"
                  value={method}
                  options={confirm.snapshot.mergeMethods}
                  onChange={setMethod}
                  disabled={review.pending}
                  style={{ width: '100%', marginBlock: 8 }}
                />
                <p>
                  提交时将再次核对代码版本与合并条件，最终由托管平台执行权限、检查和分支保护规则。
                </p>
              </>
            ) : (
              <p>关闭会结束此 PR/MR，代码不会合入目标分支。</p>
            )}
            {confirm.snapshot[confirm.action].reason && (
              <Alert type="warning" title={confirm.snapshot[confirm.action].reason} />
            )}
            {review.error && <Alert type="error" showIcon title={review.error} />}
          </>
        )}
      </Modal>
    </section>
  );
}

export function ReviewCommentComposer({
  review,
  inline = false,
}: {
  review: ReviewActions;
  inline?: boolean;
}) {
  const p = review.draft.position;
  const stale = inline && review.actions?.revision !== review.draft.revision;
  const reason =
    review.actions?.comment.reason ||
    (stale ? 'Diff 已变化。草稿已保留，请在刷新后的 Diff 中重新选择代码范围。' : undefined);
  return (
    <form
      className="pull-request-composer"
      aria-label={inline ? '代码评论' : 'Overview 评论'}
      onSubmit={(event) => {
        event.preventDefault();
        void review.submit('comment');
      }}
    >
      <h3>
        {inline && p
          ? `${p.path} · ${p.side === 'LEFT' ? '旧行' : '新行'} ${p.startLine}${p.endLine !== p.startLine ? `–${p.endLine}` : ''}`
          : '发表评论'}
      </h3>
      {!inline && p ? (
        <p>
          已有代码评论草稿，请到「文件变动」继续，或
          <Button
            type="link"
            disabled={review.pending}
            onClick={() => review.select(undefined, review.actions?.revision || '')}
          >
            改为 Overview 评论
          </Button>
        </p>
      ) : (
        <>
          <Input.TextArea
            aria-label={inline ? '代码评论内容' : 'Overview 评论内容'}
            value={review.draft.body}
            disabled={review.pending}
            onChange={(event) => review.updateBody(event.target.value)}
            autoSize={{ minRows: 3, maxRows: 12 }}
            maxLength={60000}
            placeholder="支持 Markdown。评论将直接发布到托管平台。"
          />
          {reason && (
            <p className="pull-request-muted" role="status">
              {reason}
            </p>
          )}
          <div className="pull-request-actions__buttons">
            <Button
              type="primary"
              htmlType="submit"
              loading={review.pending}
              disabled={
                review.loading ||
                !review.actions?.comment.allowed ||
                !!stale ||
                !review.draft.body.trim()
              }
            >
              发表评论
            </Button>
            {inline && (
              <Button
                disabled={review.pending}
                onClick={() => review.select(undefined, review.actions?.revision || '')}
              >
                取消选区，保留正文
              </Button>
            )}
          </div>
          {review.error && <Alert type="error" showIcon title={review.error} />}
        </>
      )}
    </form>
  );
}

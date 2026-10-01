import { FeedbackAlert } from '@alune/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Segmented, Spin } from '@alune/ui';
import type {
  PullRequestActions,
  PullRequestCommentPosition,
  PullRequestDetailQuery,
  PullRequestDiscussion,
  PullRequestItem,
  PullRequestMergeMethod,
  PullRequestMutation,
} from '@alune/shared';
import { repositoryApi } from '../api';
import { AluneModal, CheckCard, DialogHints } from '@alune/ui';
import { DialogIcon } from '@alune/ui';
import { DialogCard, DialogNote } from '@alune/ui';
import { errorMessage } from './files-tree';

// "https://github.com/team/repo" -> "team/repo" for the dialog eyebrow.
const projectLabel = (target: string) => {
  try {
    return new URL(target).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '') || target;
  } catch {
    return target;
  }
};

function mergeMethodHint(
  method: PullRequestActions['mergeMethods'][number],
  provider: PullRequestDetailQuery['provider'],
  target: string,
) {
  if (method.value === 'squash') return `将全部提交压缩为一个提交写入 ${target}`;
  if (method.value === 'rebase') return `把全部提交逐个变基到 ${target}，不创建合并提交`;
  return provider === 'github'
    ? `保留全部提交，并在 ${target} 上创建一个合并提交`
    : `保留全部提交，按项目设置的「${method.label.replace('（不压缩）', '')}」写入 ${target}`;
}

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
  const [feedbackVersion, setFeedbackVersion] = useState(0);
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
          setFeedbackVersion((value) => value + 1);
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
        setFeedbackVersion((value) => value + 1);
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
        setFeedbackVersion((value) => value + 1);
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
    feedbackVersion,
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
  summary,
}: {
  review: ReviewActions;
  query: PullRequestDetailQuery;
  /** Title and branches of the PR/MR, shown in the confirmation when known. */
  summary?: Pick<PullRequestItem, 'title' | 'sourceBranch' | 'targetBranch'>;
}) {
  const [confirm, setConfirm] = useState<{
    action: 'merge' | 'close';
    snapshot: PullRequestActions;
  }>();
  const [method, setMethod] = useState<PullRequestMergeMethod>();
  const [closeAck, setCloseAck] = useState(false);
  const [failed, setFailed] = useState(false);
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
      setCloseAck(false);
      setFailed(false);
      setConfirm({ action, snapshot });
    }
  };
  // Keep the last confirmation while the dialog animates out.
  const lastConfirm = useRef(confirm);
  if (confirm) lastConfirm.current = confirm;
  const view = confirm ?? lastConfirm.current;
  const isClose = view?.action === 'close';
  const marker = query.provider === 'github' ? '#' : '!';
  const methodLabelId = useId();
  const selectedMethod = view?.snapshot.mergeMethods.find((item) => item.value === method);
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
      {(review.actions?.merge.reason ||
        review.actions?.close.reason ||
        review.actions?.comment.reason) && (
        <FeedbackAlert
          source="review-permissions"
          type="warning"
          title="PR/MR 操作权限受限"
          description={
            [
              ...new Set(
                [
                  review.actions?.merge.reason,
                  review.actions?.close.reason,
                  review.actions?.comment.reason,
                ].filter(Boolean),
              ),
            ].join('\n') +
            (review.actions?.comment.reason === '请配置有写入权限的访问令牌。'
              ? '\n请返回 PR/MR 列表，选择具有写入权限的令牌并点击「应用到此仓库」，然后重新打开文件变动。'
              : '')
          }
        />
      )}
      {review.error && !confirm && (
        <FeedbackAlert
          source="review-error"
          eventKey={review.feedbackVersion}
          type="error"
          title={review.error}
        />
      )}
      {review.notice && (
        <FeedbackAlert
          source="review-success"
          eventKey={review.feedbackVersion}
          type="success"
          title={review.notice}
        />
      )}
      <AluneModal
        open={!!confirm}
        level={isClose ? 2 : 1}
        size="md"
        glyph={isClose ? 'pr' : 'merge'}
        eyebrow={{
          label: query.provider === 'github' ? 'PR' : 'MR',
          detail: `${projectLabel(query.target)} · ${marker}${query.number}`,
        }}
        levelLabel={isClose ? null : undefined}
        title={isClose ? '确认关闭 PR/MR' : '确认合并 PR/MR'}
        description={
          isClose ? '关闭会结束此 PR/MR，代码不会合入目标分支。' : summary?.title || undefined
        }
        hintVerb="合并"
        hints={
          isClose ? (
            <DialogHints tone="warn">
              <span>
                <DialogIcon name="warning" />
                默认聚焦「取消」
              </span>
            </DialogHints>
          ) : undefined
        }
        onCancel={() => setConfirm(undefined)}
        confirmLoading={review.pending}
        okText={isClose ? (failed ? '重试关闭' : '确认关闭') : failed ? '重试合并' : '确认合并'}
        okIcon={isClose ? 'arrow-right' : 'merge'}
        busyText={isClose ? '正在关闭…' : '正在合并…'}
        okDisabled={
          review.loading ||
          !view?.snapshot[view.action].allowed ||
          (view && !review.actions?.[view.action].allowed) ||
          (view?.action === 'merge' && !method) ||
          (isClose && !closeAck)
        }
        onOk={async () => {
          if (!confirm) return;
          if (await review.submit(confirm.action, confirm.snapshot, method)) {
            if (mounted.current) setConfirm(undefined);
          } else if (mounted.current) setFailed(true);
        }}
      >
        {view && (
          <>
            <DialogCard>
              <div className="dlg-card-row">
                <span className="dlg-repo-tile" aria-hidden="true">
                  <DialogIcon name="pr" />
                </span>
                <div className="dlg-repo-meta">
                  <strong>
                    {isClose && summary?.title
                      ? summary.title
                      : `目标分支：${view.snapshot.targetBranch}`}
                  </strong>
                  {summary?.sourceBranch ? (
                    <span className="dlg-path">
                      {summary.sourceBranch} → <b>{view.snapshot.targetBranch}</b>
                    </span>
                  ) : isClose ? (
                    <span className="dlg-path">
                      目标分支 <b>{view.snapshot.targetBranch}</b>
                    </span>
                  ) : null}
                </div>
                {!isClose &&
                  (view.snapshot.merge.allowed ? (
                    <span className="dlg-badge dlg-push-end" data-tone="success">
                      <DialogIcon name="check" />
                      可合并
                    </span>
                  ) : (
                    <span className="dlg-badge dlg-push-end" data-tone="warning">
                      <DialogIcon name="clock" />
                      暂不可合并
                    </span>
                  ))}
              </div>
            </DialogCard>
            {view.action === 'merge' && view.snapshot.mergeMethods.length > 0 && (
              <div className="dlg-fld">
                <span className="dlg-fld-label" id={methodLabelId}>
                  合并方式
                </span>
                <Segmented<PullRequestMergeMethod>
                  block
                  id="review-merge-method"
                  aria-labelledby={methodLabelId}
                  value={method}
                  options={view.snapshot.mergeMethods}
                  onChange={setMethod}
                  disabled={review.pending}
                />
                {selectedMethod && (
                  <p className="dlg-fld-hint">
                    {mergeMethodHint(selectedMethod, query.provider, view.snapshot.targetBranch)}
                  </p>
                )}
              </div>
            )}
            {!isClose && (
              <DialogNote quiet icon="shield">
                提交时将再次核对代码版本与合并条件，最终由托管平台执行权限、检查和分支保护规则。
              </DialogNote>
            )}
            {(view.snapshot[view.action].reason || review.actions?.[view.action].reason) && (
              <DialogNote
                tone="warning"
                icon="shield"
                role="status"
                title={isClose ? '当前不能关闭' : '当前不能合并'}
              >
                {view.snapshot[view.action].reason || review.actions?.[view.action].reason}
              </DialogNote>
            )}
            {review.error && (
              <FeedbackAlert
                source="review-error"
                eventKey={review.feedbackVersion}
                type="error"
                title={review.error}
              />
            )}
            {isClose && (
              <CheckCard
                tone="danger"
                checked={closeAck}
                onChange={setCloseAck}
                disabled={review.pending}
                title={`关闭 ${marker}${query.number}，代码不合入 ${view.snapshot.targetBranch}`}
                description="之后仍可在托管平台上重新打开"
              />
            )}
          </>
        )}
      </AluneModal>
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
          {stale && reason && (
            <FeedbackAlert source="review-comment-permission" type="warning" title={reason} />
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
        </>
      )}
    </form>
  );
}

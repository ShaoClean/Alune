import { useEffect, useRef, useState } from 'react';
import { AluneModal, Button, Input, Select, Spin } from '@alune/ui';
import type {
  CreatePullRequest,
  CreatedPullRequest,
  PullRequestCreationPreview,
  PullRequestCreationQuery,
} from '@alune/shared';
import { gitApi, repositoryApi } from '../api';
import { aiApi, aiError } from '../api/ai';
import { defaultCommitModel, useAiSettingsStore } from '../stores/aiSettingsStore';
import { errorMessage } from './files-tree';

export function CreatePullRequestDialog({
  repoId,
  query,
  onClose,
  onCreated,
  onExisting,
}: {
  repoId: string;
  query: PullRequestCreationQuery;
  onClose: () => void;
  onCreated: (result: CreatedPullRequest) => void;
  onExisting: (number: number) => void;
}) {
  const [preview, setPreview] = useState<PullRequestCreationPreview | null>(null);
  const [target, setTarget] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState(false);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [busy, setBusy] = useState<'preview' | 'push' | 'ai' | 'create' | null>(null);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<{
    title: string;
    description: string;
    truncated: boolean;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const initialized = useRef(false);
  const submission = useRef<{ fingerprint: string; request: CreatePullRequest } | null>(null);
  const { settings, load } = useAiSettingsStore();
  const model = defaultCommitModel(settings);
  const context = JSON.stringify(query);
  const valid = preview && target === preview.targetBranch;
  const ready =
    valid &&
    !preview.pushRequired &&
    !preview.existing &&
    preview.commits.length > 0 &&
    preview.sourceBranch !== preview.targetBranch;

  const refresh = async (targetBranch?: string) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy('preview');
    setError('');
    setGenerated(null);
    setPreview(null);
    try {
      const result = await repositoryApi.previewPullRequest(
        repoId,
        { ...query, ...(targetBranch ? { targetBranch } : {}) },
        current.signal,
      );
      if (current.signal.aborted) return;
      setPreview(result);
      setTarget(result.targetBranch);
      if (!initialized.current) {
        setTitle(
          result.commits.length === 1
            ? result.commits[0].message.split('\n')[0].slice(0, 200)
            : result.sourceBranch,
        );
        setDescription(result.template);
        initialized.current = true;
      }
    } catch (failure) {
      if (!current.signal.aborted) setError(errorMessage(failure, '无法预览分支改动，请重试。'));
    } finally {
      if (!current.signal.aborted) setBusy(null);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    void refresh();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
    // Credentials and remote changes invalidate pending reads without erasing the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, context]);

  const push = async () => {
    if (!preview) return;
    setBusy('push');
    setError('');
    try {
      await gitApi.push(repoId, query.remote, preview.sourceBranch, false, true);
      if (mounted.current) await refresh(target);
    } catch (failure) {
      if (mounted.current) {
        setError(errorMessage(failure, '推送失败，请检查 Git 凭据和远端配置。'));
        setBusy(null);
      }
    }
  };

  const generate = async () => {
    if (!ready || !settings) return;
    const current = new AbortController();
    controller.current = current;
    setBusy('ai');
    setError('');
    try {
      const result = await aiApi.generatePullRequest(
        repoId,
        {
          ...query,
          sourceBranch: preview.sourceBranch,
          targetBranch: preview.targetBranch,
          revision: preview.revision,
          configRevision: settings.revision,
        },
        current.signal,
      );
      if (!current.signal.aborted) setGenerated(result);
    } catch (failure) {
      if (!current.signal.aborted) setError(aiError(failure));
    } finally {
      if (!current.signal.aborted) setBusy(null);
    }
  };

  const create = async () => {
    if (!ready || !title.trim() || busy) return;
    const body = {
      ...query,
      sourceBranch: preview.sourceBranch,
      targetBranch: preview.targetBranch,
      revision: preview.revision,
      title,
      description,
      draft,
      assignees,
      reviewers,
      labels,
    };
    const fingerprint = JSON.stringify(body);
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, request: { ...body, operationId: crypto.randomUUID() } };
    setBusy('create');
    setError('');
    try {
      const result = await repositoryApi.createPullRequest(repoId, submission.current.request);
      if (mounted.current) onCreated(result);
    } catch (failure) {
      if (mounted.current)
        setError(errorMessage(failure, '未能确认创建结果，请先刷新列表核对，表单已保留。'));
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  return (
    <AluneModal
      open
      size="xl"
      glyph="pr"
      title={query.provider === 'github' ? '创建 Pull Request' : '创建 Merge Request'}
      eyebrow={{ label: 'PR/MR', detail: query.remote }}
      okText={draft ? '创建草稿' : '创建 PR/MR'}
      busyText="正在创建…"
      confirmLoading={busy === 'create'}
      okDisabled={!ready || !title.trim() || Boolean(busy)}
      onOk={create}
      onCancel={() => {
        if (busy !== 'create' && busy !== 'push') onClose();
      }}
    >
      <div className="pr-create">
        <div className="pr-create__branches">
          <span>
            源分支 <code>{preview?.sourceBranch || query.sourceBranch || '当前分支'}</code>
          </span>
          <label className="dlg-fld">
            <span className="dlg-fld-label">目标分支</span>
            <Input
              aria-label="目标分支"
              list="pr-create-branches"
              value={target}
              disabled={Boolean(busy)}
              onChange={(event) => {
                setTarget(event.target.value);
                setGenerated(null);
              }}
            />
            <datalist id="pr-create-branches">
              {preview?.branches.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <Button disabled={Boolean(busy)} onClick={() => void refresh(target)}>
            预览改动
          </Button>
        </div>
        {busy === 'preview' && (
          <p role="status">
            <Spin size="small" /> 正在读取分支、提交与文件…
          </p>
        )}
        {error && (
          <p role="alert" className="pr-create__error">
            {error}
          </p>
        )}
        {preview?.notice && <p className="pr-create__notice">{preview.notice}</p>}
        {preview?.pushRequired && preview.pushBlockedReason && (
          <p role="alert">{preview.pushBlockedReason}</p>
        )}
        {preview?.pushRequired && (
          <Button loading={busy === 'push'} disabled={Boolean(busy)} onClick={() => void push()}>
            推送到 {query.remote} 并设置上游
          </Button>
        )}
        {preview?.existing && (
          <p>
            已存在同分支的请求：
            <Button onClick={() => onExisting(preview.existing!.number)}>
              打开 {preview.existing.title}
            </Button>
          </p>
        )}
        {valid && (
          <details className="pr-create__preview" open>
            <summary>
              改动预览 · {preview.commits.length} 条提交 · {preview.files.length} 个文件
            </summary>
            <div className="pr-create__changes">
              <ol>
                {preview.commits.map((commit) => (
                  <li key={commit.hash}>
                    <code>{commit.hash.slice(0, 8)}</code> {commit.message.split('\n')[0]}
                  </li>
                ))}
              </ol>
              {preview.files.map((file) => (
                <details key={file.path}>
                  <summary>
                    {file.path}{' '}
                    <span>
                      +{file.additions ?? '?'} −{file.deletions ?? '?'}
                    </span>
                  </summary>
                  {file.notice && <p>{file.notice}</p>}
                  {file.patch && <pre>{file.patch}</pre>}
                </details>
              ))}
            </div>
          </details>
        )}
        <label className="dlg-fld">
          <span className="dlg-fld-label">标题</span>
          <Input
            aria-label="PR/MR 标题"
            value={title}
            maxLength={200}
            disabled={busy === 'create'}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="dlg-fld">
          <span className="dlg-fld-label">描述</span>
          <Input.TextArea
            aria-label="PR/MR 描述"
            value={description}
            maxLength={60000}
            rows={7}
            disabled={busy === 'create'}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="pr-create__ai">
          <p>
            AI 将接收所选分支的提交信息、文件路径、可用文本 Diff 和目标分支中的 PR/MR 模板（
            {preview?.templatePath || '未找到模板'}）。不包含未提交改动或访问令牌；内容最多 60000
            个字符，过大时截断。
          </p>
          <Button
            disabled={!ready || !model || Boolean(busy)}
            loading={busy === 'ai'}
            onClick={() => void generate()}
          >
            AI 起草标题与描述
          </Button>
          {busy === 'ai' && (
            <Button
              onClick={() => {
                controller.current?.abort();
                setBusy(null);
              }}
            >
              取消生成
            </Button>
          )}
          <span>
            {model
              ? `${model.provider.name} · ${model.model.id}（沿用提交生成的服务商与模型）`
              : '未配置 AI，可直接手动创建。'}
          </span>
          {generated && (
            <div className="pr-create__generated">
              <strong>{generated.title}</strong>
              <pre>{generated.description}</pre>
              {generated.truncated && <p>输入内容有截断，请结合完整改动核对草稿。</p>}
              <Button
                disabled={Boolean(busy)}
                onClick={() => {
                  setTitle(generated.title);
                  setDescription(generated.description);
                  setGenerated(null);
                }}
              >
                将此草稿填入表单
              </Button>
              <Button disabled={Boolean(busy)} onClick={() => setGenerated(null)}>
                保留原内容
              </Button>
            </div>
          )}
        </div>
        <label className="pr-create__draft">
          <input
            type="checkbox"
            checked={draft}
            disabled={busy === 'create'}
            onChange={(e) => setDraft(e.target.checked)}
          />{' '}
          创建为草稿
        </label>
        <details>
          <summary>指派人、审阅者和标签（可选）</summary>
          {preview?.options.notice && <p>{preview.options.notice}</p>}
          <div className="pr-create__options">
            {(
              [
                ['指派人', assignees, setAssignees, preview?.options.assignees],
                ['审阅者', reviewers, setReviewers, preview?.options.reviewers],
                ['标签', labels, setLabels, preview?.options.labels],
              ] as const
            ).map(([label, value, setValue, options]) => (
              <label key={label} className="dlg-fld">
                <span className="dlg-fld-label">{label}</span>
                <Select
                  mode="multiple"
                  aria-label={label}
                  value={value}
                  onChange={setValue}
                  options={options || []}
                  disabled={Boolean(busy) || !options?.length}
                  placeholder={options?.length ? '可不选' : '当前无可选项或权限不足'}
                  optionFilterProp="label"
                />
              </label>
            ))}
          </div>
        </details>
      </div>
    </AluneModal>
  );
}

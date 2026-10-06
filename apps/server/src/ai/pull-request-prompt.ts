import { BadGatewayException } from '@nestjs/common';
import type { PullRequestCreationPreview } from '@alune/shared';

// Bound the complete serialized payload, not just individual patches.
export function pullRequestPrompt(preview: PullRequestCreationPreview) {
  const input = {
    sourceBranch: preview.sourceBranch,
    targetBranch: preview.targetBranch,
    templatePath: preview.templatePath,
    template: preview.template.slice(0, 12000),
    commits: [] as { hash: string; message: string }[],
    files: [] as {
      path: string;
      status: string;
      patch: string | null;
      notice?: string;
    }[],
    truncated: Boolean(
      preview.notice || preview.files.some((file) => file.notice),
    ),
  };
  while (JSON.stringify(input).length > 30000) {
    input.template = input.template.slice(
      0,
      Math.floor(input.template.length / 2),
    );
    input.truncated = true;
  }
  let commitSize = 0;
  for (const commit of preview.commits) {
    const message = commit.message.slice(0, 2000);
    if (commitSize + message.length > 12000) {
      input.truncated = true;
      break;
    }
    input.commits.push({ hash: commit.hash, message });
    if (JSON.stringify(input).length > 42000) {
      input.commits.pop();
      input.truncated = true;
      break;
    }
    commitSize += message.length;
    if (message.length !== commit.message.length) input.truncated = true;
  }
  for (const file of preview.files) {
    const patch = file.patch?.slice(0, 8000) ?? null;
    const item = {
      path: file.path,
      status: file.status,
      patch,
      notice: file.notice,
    };
    input.files.push(item);
    if (JSON.stringify(input).length > 60000) {
      input.files.pop();
      input.truncated = true;
      break;
    }
    if (patch !== file.patch) input.truncated = true;
  }
  return input;
}

export function parsePullRequest(content: string) {
  try {
    const value = JSON.parse(
      content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'),
    );
    if (
      typeof value?.title !== 'string' ||
      !value.title.trim() ||
      value.title.length > 200 ||
      /[\r\n\0]/.test(value.title) ||
      typeof value.description !== 'string' ||
      value.description.length > 12000 ||
      value.description.includes('\0')
    )
      throw new Error();
    return { title: value.title.trim(), description: value.description.trim() };
  } catch {
    throw new BadGatewayException(
      'AI 返回的 PR/MR 标题或描述格式无效，请重试；原表单已保留。',
    );
  }
}

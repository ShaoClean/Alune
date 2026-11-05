import {
  PartialChangesError,
  PartialReads,
  PartialUnsupported as Unsupported,
  partialHash as hash,
  partialStale as stale,
} from '@alune/agent/git/partial-changes';
import type { PartialDiffRequest, PatchHunk } from '@alune/shared';

const MAX_BYTES = 2 * 1024 * 1024;
const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const missing = (error: any) => error?.code === 2 || error?.code === 'ENOENT';
export { PartialChangesError } from '@alune/agent/git/partial-changes';
type FileContent = { text: string; mode: string } | null;

// Reconstruct the result from the trusted diff and target blob. Retained rows
// keep their original bytes, including mixed line endings and BOMs.
export function selectedContent(
  base: string,
  hunks: PatchHunk[],
  selected: Set<number>,
  reverse: boolean,
) {
  const source = split(base);
  const output: string[] = [];
  let cursor = 0;
  // Git normalizes a text-attributed CRLF worktree before diffing. Restore its
  // line endings on discard; indexed blobs are passed here without conversion.
  const normalizedCRLF =
    reverse &&
    hunks.some((hunk) => {
      let position = hunk.newCount ? hunk.newStart - 1 : hunk.newStart;
      return hunk.rows.some((row) => {
        if (row.kind === 'remove') return false;
        const actual = source[position++];
        return (
          actual?.endsWith('\r\n') &&
          !row.content.endsWith('\r\n') &&
          actual.replace(/\r\n$/, '\n') === row.content
        );
      });
    });
  for (const hunk of hunks) {
    const start = reverse ? hunk.newStart : hunk.oldStart;
    const count = reverse ? hunk.newCount : hunk.oldCount;
    const position = count ? start - 1 : start;
    if (position < cursor || position > source.length) throw stale();
    for (let i = cursor; i < position; i++) output.push(source[i]);
    cursor = position;
    for (const row of hunk.rows) {
      const consumes = row.kind === 'context' || row.kind === (reverse ? 'add' : 'remove');
      if (consumes) {
        const actual = source[cursor++];
        if (
          actual !== row.content &&
          !(normalizedCRLF && actual?.replace(/\r\n$/, '\n') === row.content)
        )
          throw stale();
        if (row.kind === 'context' || !selected.has(row.index)) output.push(actual);
      } else if (selected.has(row.index)) {
        output.push(
          normalizedCRLF && !row.content.endsWith('\r\n')
            ? row.content.replace(/\n$/, '\r\n')
            : row.content,
        );
      }
    }
  }
  for (let i = cursor; i < source.length; i++) output.push(source[i]);
  // Keeping an unterminated old line while adding a new line after it requires
  // a separator. Never concatenate two selected logical lines into one.
  return output
    .map((line, i) =>
      i < output.length - 1 && !line.endsWith('\n')
        ? line + (normalizedCRLF ? '\r\n' : '\n')
        : line,
    )
    .join('');
}

function fullPatch(file: string, before: FileContent, after: FileContent) {
  const a = JSON.stringify('a/' + file),
    b = JSON.stringify('b/' + file);
  const oldLines = split(before?.text ?? ''),
    newLines = split(after?.text ?? '');
  const rows = (lines: string[], prefix: string) =>
    lines
      .map(
        (line) => prefix + line + (line.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'),
      )
      .join('');
  return (
    `diff --git ${a} ${b}\n` +
    (!before
      ? `new file mode ${after!.mode}\n`
      : !after
        ? `deleted file mode ${before.mode}\n`
        : '') +
    `--- ${before ? a : '/dev/null'}\n+++ ${after ? b : '/dev/null'}\n` +
    `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n` +
    rows(oldLines, '-') +
    rows(newLines, '+')
  );
}

export class PartialChanges extends PartialReads {
  async apply(root: string, request: PartialDiffRequest) {
    if (
      !request ||
      (request.fullFile !== undefined && typeof request.fullFile !== 'boolean') ||
      !['stage', 'unstage', 'discard'].includes(request.action) ||
      typeof request.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(request.revision)
    )
      throw new PartialChangesError('无效的部分改动请求，请刷新后重试。');
    if (request.action === 'discard' && request.confirmed !== true)
      throw new PartialChangesError('请先确认放弃所选改动。');
    const staged = request.action === 'unstage';
    let current;
    try {
      current = await this.read(root, request.file, staged, request.fullFile);
    } catch (error) {
      if (error instanceof Unsupported) throw stale();
      throw error;
    }
    if (current.revision !== request.revision) throw stale();
    const { hunks, state } = current;
    const selection = request.selection;
    const byHunk = Array.isArray(selection?.hunks);
    const ids = byHunk ? selection.hunks : selection?.lines;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 10_000 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 0) ||
      new Set(ids).size !== ids.length ||
      (byHunk ? selection.lines !== undefined : selection?.hunks !== undefined)
    )
      throw new PartialChangesError('请选择有效的改动块或行。');
    const changeRows = hunks.flatMap((hunk) => hunk.rows.filter((row) => row.kind !== 'context'));
    const allowed = new Set(
      byHunk ? hunks.map((hunk) => hunk.index) : changeRows.map((row) => row.index),
    );
    if (ids.some((id) => !allowed.has(id)))
      throw new PartialChangesError('选择包含无效的改动块或行。');
    const selected = new Set(
      byHunk
        ? hunks
            .filter((hunk) => ids.includes(hunk.index))
            .flatMap((hunk) =>
              hunk.rows.filter((row) => row.kind !== 'context').map((row) => row.index),
            )
        : ids,
    );
    const reverse = request.action !== 'stage';
    const base = request.action === 'discard' ? state.working : state.cached;
    const destination = staged
      ? state.before
      : request.action === 'stage'
        ? state.working
        : state.cached;
    const text = selectedContent(base?.text ?? '', hunks, selected, reverse);
    const result =
      !text && !destination ? null : { text, mode: base?.mode ?? destination?.mode ?? '100644' };
    const patch = fullPatch(request.file, base, result);
    const args = [
      'apply',
      '--whitespace=nowarn',
      '--unidiff-zero',
      ...(request.action === 'discard' ? [] : ['--cached']),
    ];
    await this.git(root, [...args, '--check', '-'], { stdin: patch });
    // Re-read after Git's applicability check, including worktree bytes even for
    // unstage. A stale UI must never silently act on a newer external edit.
    if (hash(await this.snapshot(root, request.file)) !== hash(state)) throw stale();
    await this.git(root, [...args, '-'], { stdin: patch });
    return { success: true as const };
  }
}

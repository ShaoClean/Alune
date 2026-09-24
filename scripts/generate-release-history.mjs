import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateReleaseNotes, selectLatestPublishedTag, selectPreviousTag } from './generate-release-notes.mjs';
import { stableTagPattern } from './release-version.mjs';
import { renderReleaseNotes } from './release-notes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

export function generateReleaseHistoryMarkdown({ publishedTags, repository, directory = root }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GH_REPO must be an owner/repository name');
  const latest = selectLatestPublishedTag('HEAD', publishedTags, directory);
  // git-cliff requires a commit ID, rather than the symbolic HEAD, for an all-history range.
  const range = latest ? `${latest}..HEAD` : git(directory, 'rev-parse', 'HEAD^{commit}');
  const pending = renderReleaseNotes([range, '--repository', directory, '--tag-pattern', '^$'], directory).trim()
    || '## 待发布\n\n暂无待发布变更。';
  const compare = latest ? `compare/${latest}...development` : 'commits/development';
  const tags = git(directory, 'tag', '--merged', 'HEAD', '--sort=-version:refname').split('\n')
    .filter((tag) => stableTagPattern.test(tag) && publishedTags.includes(tag));
  const history = tags.map((tag) => generateReleaseNotes({
    tag, previousTag: selectPreviousTag(tag, publishedTags, directory), repository, directory,
  }).trim());
  return [
    '# 更新日志',
    '此 Issue 由 GitHub Actions 自动更新。待发布内容来自 `development` 分支的已合并提交；正式版本以 GitHub Release 为准。[查看项目进度](https://github.com/users/ShaoClean/projects/1)。',
    `${pending}\n\n**查看待发布提交**：[${latest || '仓库起点'} → development](https://github.com/${repository}/${compare})`,
    ...history,
  ].join('\n\n') + '\n';
}

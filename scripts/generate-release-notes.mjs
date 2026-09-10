import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableTagPattern } from './release-version.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

export function selectPreviousTag(tag, publishedTags, directory = root) {
  if (!stableTagPattern.test(tag)) throw new Error('A stable release tag (vX.Y.Z) is required');
  const tags = git(directory, 'tag', '--merged', tag, '--sort=-version:refname').split('\n');
  const current = tags.indexOf(tag);
  if (current === -1) throw new Error(`Missing local release tag: ${tag}`);
  const ancestors = new Map(git(directory, 'rev-list', '--first-parent', tag).split('\n').map((sha, index) => [sha, index]));
  const published = new Set(publishedTags);
  let previous;
  let distance = Infinity;
  for (const candidate of tags.slice(current + 1)) {
    if (!stableTagPattern.test(candidate) || !published.has(candidate)) continue;
    const index = ancestors.get(git(directory, 'rev-parse', `${candidate}^{commit}`));
    if (index !== undefined && index < distance) {
      previous = candidate;
      distance = index;
    }
  }
  return previous;
}

export function generateReleaseNotes({ tag, previousTag, repository, directory = root }) {
  if (!stableTagPattern.test(tag) || (previousTag && !stableTagPattern.test(previousTag))) {
    throw new Error('Release boundaries must be stable tags (vX.Y.Z)');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GH_REPO must be an owner/repository name');
  const range = previousTag ? `${previousTag}..${tag}` : git(directory, 'rev-parse', `${tag}^{commit}`);
  const notes = execFileSync(process.execPath, [
    fileURLToPath(import.meta.resolve('git-cliff/cli')),
    range, '--repository', directory, '--config', path.join(root, 'cliff.toml'),
    // Intermediate failed/unpublished tags must not split this release's notes.
    '--tag-pattern', `^${tag.replaceAll('.', '\\.')}$`,
  ], { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
  const body = notes || `## ${tag}\n\n本次更新主要包含构建、测试或维护调整。`;
  const link = previousTag ? `compare/${previousTag}...${tag}` : `commits/${tag}`;
  return `${body}\n\n**完整变更**：https://github.com/${repository}/${link}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [tag, output = 'release-notes.md', ...extra] = process.argv.slice(2);
    if (!tag || extra.length) throw new Error('Usage: generate-release-notes.mjs <vX.Y.Z> [output.md]');
    if (!stableTagPattern.test(tag)) throw new Error('A stable release tag (vX.Y.Z) is required');
    const repository = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
    if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Set GH_REPO to owner/repository');
    // API errors fail the job rather than silently changing the release boundary.
    const publishedTags = execFileSync('gh', [
      'api', '--paginate', `repos/${repository}/releases?per_page=100`, '--jq',
      '.[] | select(.draft == false and .prerelease == false) | .tag_name',
    ], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
    const previousTag = selectPreviousTag(tag, publishedTags);
    writeFileSync(path.resolve(output), generateReleaseNotes({ tag, previousTag, repository }));
    console.log(`[release-notes] ${previousTag || 'repository start'} -> ${tag}: ${output}`);
  } catch (error) {
    console.error(`[release-notes] ${error.message}`);
    process.exitCode = 1;
  }
}

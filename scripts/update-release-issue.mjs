import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedReleaseTags } from './generate-release-notes.mjs';
import { generateReleaseHistoryMarkdown } from './generate-release-history.mjs';

export function updateReleaseIssue({ repository, issueNumber, body }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GH_REPO must be an owner/repository name');
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('A positive issue number is required');
  const endpoint = `repos/${repository}/issues/${issueNumber}`;
  const current = JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8' }));
  if (current.pull_request) throw new Error(`Issue #${issueNumber} is a pull request`);
  if (current.body === body) return false;
  execFileSync('gh', ['api', '--method', 'PATCH', '--input', '-', endpoint], {
    input: JSON.stringify({ body }), encoding: 'utf8', stdio: ['pipe', 'ignore', 'inherit'],
  });
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [number, ...extra] = process.argv.slice(2);
    if (extra.length || !/^[1-9]\d*$/.test(number || '')) throw new Error('Usage: update-release-issue.mjs <issue-number>');
    const repository = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
    if (!repository) throw new Error('Set GH_REPO to owner/repository');
    const body = generateReleaseHistoryMarkdown({ publishedTags: publishedReleaseTags(repository), repository });
    const updated = updateReleaseIssue({ repository, issueNumber: Number(number), body });
    console.log(`[release-issue] #${number} ${updated ? 'updated' : 'already current'}`);
  } catch (error) {
    console.error(`[release-issue] ${error.message}`);
    process.exitCode = 1;
  }
}

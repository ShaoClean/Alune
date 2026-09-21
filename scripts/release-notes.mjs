import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = path.join(root, 'cliff.toml');
const cli = fileURLToPath(import.meta.resolve('git-cliff/cli'));

function issueReferences(commit) {
  const references = new Set();
  for (const line of (commit.raw_message || '').split('\n').slice(1)) {
    const match = line.match(/^\s*(?:refs?|closes?|closed|fix(?:es|ed)?|resolves?|resolved)\s*:?\s+(.+)$/i);
    if (!match) continue;
    // Only explicit reference lists count; prose mentioning an issue is not an identity.
    const tokens = match[1].trim().split(/\s*(?:,|\band\b)\s*|\s+/i);
    if (!tokens.every((token) => /^(?:[\w.-]+\/[\w.-]+)?#[1-9]\d*$/.test(token))) continue;
    for (const token of tokens) references.add(token.toLowerCase());
  }
  return [...references].sort();
}

export function deduplicateReleaseCommits(commits) {
  const seen = new Set();
  return commits.filter((commit) => {
    const context = [commit.group, commit.scope || '', Boolean(commit.breaking), commit.breaking_description || ''];
    const title = commit.message.split('\n')[0].replace(/(?:\s+\(#\d+\))+\s*$/, '').trim();
    const issues = issueReferences(commit);
    const keys = [JSON.stringify([...context, 'title', title])];
    if (issues.length) keys.push(JSON.stringify([...context, 'issues', issues]));
    const duplicate = keys.some((key) => seen.has(key));
    for (const key of keys) seen.add(key);
    return !duplicate;
  });
}

export function renderReleaseNotes(args, directory = root) {
  const options = { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 };
  const releases = JSON.parse(execFileSync(process.execPath, [cli, ...args, '--config', config, '--context'], options));
  for (const release of releases) release.commits = deduplicateReleaseCommits(release.commits);
  return execFileSync(process.execPath, [cli, '--config', config, '--from-context', '-'], {
    ...options, input: JSON.stringify(releases),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = [];
    let output;
    const input = process.argv.slice(2);
    for (let index = 0; index < input.length; index++) {
      const arg = input[index];
      if (['--output', '-o', '--repository', '-r', '--tag', '-t', '--tag-pattern'].includes(arg)) {
        const value = input[++index];
        if (!value || value.startsWith('-')) throw new Error(`${arg} 需要参数值`);
        if (arg === '--output' || arg === '-o') output = value;
        else args.push(arg, value);
      } else if (['--latest', '-l', '--current', '--unreleased', '-u'].includes(arg) || !arg.startsWith('-')) {
        args.push(arg);
      } else {
        throw new Error(`不支持的预览参数：${arg}；支持范围、--repository、--tag、--tag-pattern、--latest、--current、--unreleased 和 --output`);
      }
    }
    const notes = renderReleaseNotes(args);
    if (output) writeFileSync(path.resolve(output), notes);
    else process.stdout.write(notes);
  } catch (error) {
    console.error(`[release-notes] ${error.message}`);
    process.exitCode = 1;
  }
}

// Reviewed scenario-to-callback associations. Incidental traces earn no IDs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateLedger } from './p0-test-receipts.mjs';
import { readPolicy } from './acceptance-policy.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const web = 'apps/web/src/';
const layout = web + 'components/LayoutSettings.tsx';
const navigation = web + 'components/useDiffChangeNavigation.ts';
const full = web + 'components/useDiffFullscreen.ts';
const markdown = web + 'components/MarkdownPreview.tsx';
const menu = web + 'components/WorkspaceFileMenu.tsx';
const highlighter = web + 'components/useHighlighter.ts';
const diffHighlight = web + 'components/useDiffHighlight.ts';
const handler = (file, name, kind = 'ui-handler') => `${kind}:${file}:${name}`;
const responsibility = (file, names) => [`source:${file}:${file}`, ...names.map(n => `export:${file}:${n}`)];
export const browserBindings = [
  { prefix: 'layout panel visibility', entries: ['Switch.onChange:53', 'Switch.onChange:66'].map(n => handler(layout, n)) },
  { prefix: 'layout native range', entries: ['input.onChange:85', 'input.onChange:98'].map(n => handler(layout, n)) },
  { prefix: 'layout segmented Diff', entries: ['Segmented.onChange:113', 'Button.onClick:30'].map(n => handler(layout, n)) },
  { prefix: 'layout completion and Escape', entries: ['Button.onClick:33', 'AluneModal.onCancel:22'].map(n => handler(layout, n)), responsibility: responsibility(layout, ['LayoutSettings']) },
  { prefix: 'Diff navigation advances', entries: [handler(navigation, 'body.addEventListener:143', 'ui-listener')], responsibility: responsibility(navigation, ['useDiffChangeNavigation']) },
  { prefix: 'Diff fullscreen retains', entries: [], responsibility: responsibility(full, ['useDiffFullscreen']) },
  { prefix: 'Markdown external image', entries: ['button.onClick:95', 'img.onError:69'].map(n => handler(markdown, n)) },
  { prefix: 'File context menu Tab', entries: [handler(menu, 'onKeyDown:223', 'ui-object-handler'), handler(menu, 'window.addEventListener:87', 'ui-listener')] },
  { prefix: 'Diff highlighter loads', entries: [], responsibility: [...responsibility(highlighter, ['HIGHLIGHT_MAX_CHARS', 'useHighlighter']), ...responsibility(diffHighlight, ['useDiffHighlight'])] },
];
export function reviewedBrowserRuns(ledger, progress, result, sha, proof) {
  validateLedger(ledger);
  assert.equal(progress.currentSha, sha);
  assert.equal(result.status, 'passed');
  assert.equal(result.records.length, 10);
  const remaining = new Set(progress.rows.filter(r => r.status === 'needs-explicit-assertion').map(r => r.id));
  const known = new Map(ledger.entries.map(r => [r.id, r]));
  const cleanup = result.records.find(r => r.name.startsWith('Diff navigation unmount'));
  assert.deepEqual(cleanup?.facts, { index: -1, listenersAfterUnmount: 0, listenersAfterRemount: 1 });
  const seen = new Set();
  return browserBindings.map(binding => {
    const matches = result.records.filter(r => r.name.startsWith(binding.prefix));
    assert.equal(matches.length, 1, binding.prefix);
    const record = matches[0];
    assert(record.facts && typeof record.facts === 'object');
    // Earlier raw output included a network-request placeholder. The DOM
    // assertion verifies failure/fallback; it does not record network traffic.
    const facts = binding.prefix === 'Markdown external image' ? { failed: record.facts.failed } : record.facts;
    if (binding.prefix === 'Markdown external image') assert.equal(facts.failed, true);
    for (const id of binding.entries) assert(record.executed.includes(id), 'Missing actual callback: ' + id);
    const entries = [...binding.entries, ...(binding.responsibility ?? [])];
    for (const id of entries) {
      assert(known.has(id) && remaining.has(id) && !seen.has(id), 'Unknown, credited or duplicate ID: ' + id); seen.add(id);
    }
    return { sha, target: 'darwin-arm64', entries, result: 'passed', scenario: record.name,
      assertion: 'Actual browser pointer/keyboard or explicit scroll/resize stimulus followed by exact rendered/state/focus assertions: ' + JSON.stringify(facts),
      limitations: result.limitations + ' Only the listed reviewed callbacks/responsibilities are associated; unrelated trace hits are excluded. Source/export IDs associate the stated responsibility only. Transitive dirty fixture inputs are recorded separately, never represented as clean desktop integration.', proof };
  });
}
export function main(args) {
  const [ledgerFile, progressFile, outputArg, policyFile, spaceId, base] = args;
  if (!base || !/^\d+$/.test(spaceId)) throw Error('Usage: p0-layout-browser-receipts.mjs LEDGER PROGRESS NEW_OUTPUT POLICY EGO_SPACE BASE_URL');
  assert.equal(process.platform + '-' + process.arch, 'darwin-arm64');
  const policy = readPolicy(policyFile); assert.equal(policy.id, 'mac-arm64-local-2026-11-08');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile)), progress = JSON.parse(fs.readFileSync(progressFile));
  validateLedger(ledger);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const output = path.resolve(outputArg); fs.mkdirSync(output, { recursive: false });
  const enumerate = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? enumerate(dir + '/' + e.name) : [dir + '/' + e.name]);
  const testInputs = ['apps/web/tests/p0-layout-navigation-fixture.tsx', 'apps/web/tests/p0-layout-navigation-fixture.html', 'apps/web/tests/p0-layout-navigation-browser.mjs', 'apps/web/tests/ui-audit.ts', 'apps/web/tests/ui-audit-bindings.ts', 'apps/web/tests/p0-ui-index.json', 'apps/web/vite.config.ts', 'apps/web/agent-dev.ts'];
  const files = [...new Set([...enumerate('apps/web/src'), ...enumerate('packages/ui/src'), ...testInputs])];
  const inputs = Object.fromEntries(files.map(file => [file, digest(fs.readFileSync(path.join(root, file)))]));
  for (const file of [layout, navigation, full, markdown, menu, highlighter, diffHighlight])
    assert.equal(inputs[file], digest(execFileSync('git', ['show', sha + ':' + file], { cwd: root })), 'Tested business input differs from HEAD: ' + file);
  const resultFile = path.join(output, 'result.json');
  const script = `const task=await taskSpace(${Number(spaceId)}), page=task.page('p1');
const {runLayoutNavigationChecks}=await import(${JSON.stringify(path.join(root, testInputs[2]))});
const result=await runLayoutNavigationChecks(page,${JSON.stringify(base)});
const fs=await import('node:fs/promises');await fs.writeFile(${JSON.stringify(resultFile)},JSON.stringify({...result,status:'passed'},null,2)+'\\n');
console.log(await page.snapshot());`;
  fs.writeFileSync(path.join(output, 'ego-script.mjs'), script);
  const fd = fs.openSync(path.join(output, 'browser.log'), 'wx');
  let execution;
  try { execution = spawnSync('ego-browser', ['nodejs'], { input: script, cwd: root, stdio: ['pipe', fd, fd], timeout: 180000 }); }
  finally { fs.closeSync(fd); }
  assert.equal(execution.status, 0, 'Browser checks failed; inspect browser.log');
  for (const [file, expected] of Object.entries(inputs)) assert.equal(digest(fs.readFileSync(path.join(root, file))), expected, 'Browser input changed: ' + file);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sha);
  const result = JSON.parse(fs.readFileSync(resultFile));
  const provenance = { sha, platform: process.platform, arch: process.arch, policy: policy.id, os: os.release(), inputs,
    status: execFileSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }), execution: { status: execution.status },
    driverSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), scriptSha256: digest(script), result };
  const bytes = JSON.stringify(provenance, null, 2) + '\n';
  const runs = reviewedBrowserRuns(ledger, progress, result, sha, { path: 'browser-proof.json', sha256: digest(bytes) });
  fs.writeFileSync(path.join(output, 'browser-proof.json'), bytes);
  fs.writeFileSync(path.join(output, 'receipts.json'), JSON.stringify({ stage: 'after-retirement', policy: policy.id, baseline: ledger.sha, sha, runs }, null, 2) + '\n');
  console.log(JSON.stringify({ scenarios: result.records.length, associated: new Set(runs.flatMap(r => r.entries)).size, uiCallbacks: browserBindings.flatMap(b => b.entries).length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));

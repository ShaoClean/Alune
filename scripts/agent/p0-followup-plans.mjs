// Reviewed exact assertions, not import/coverage inference. Generation alone earns no receipt.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateLedger, validateBindings } from './p0-test-receipts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const ref = (file, name, declaration = name) => {
  const lines = read(file).split('\n');
  const matches = lines.flatMap((line, index) => line.includes(declaration) && /\btest\(/.test(line) ? [index + 1] : []);
  if (matches.length !== 1) throw Error('Ambiguous reviewed declaration: ' + name);
  return { file, name, line: matches[0] };
};
const preloadTest = 'apps/desktop/test/p0-preload.test.cjs';
const preload = 'apps/desktop/src/preload.cjs';
const update = 'apps/desktop/src/update-ipc.cjs';
const invokes = [
  ['updates:state', 14], ['updates:check', 15], ['updates:download', 16],
  ['updates:cancel', 17], ['updates:install', 18], ['updates:open-file', 19], ['updates:reveal-file', 20],
  ['workspace:choose-directory', 29], ['workspace:load', 30], ['workspace:clear', 35],
  ['logs:open-window', 39], ['logs:open-directory', 40], ['logs:choose-directory', 41],
];
const limitation = 'Real preload evaluated in an isolated VM with injected Electron IPC; no native window, OS credentials, installer or end-to-end main-process acceptance.';
const binding = (entries, implementation, tests, assertion, limitations = limitation) =>
  ({ entries, implementation, tests, assertion, limitations });

export function preloadPlan() {
  const bindings = invokes.map(([channel, line]) => binding(
    [`channel:${preload}:ipcRenderer.invoke:${channel}:${line}`], [preload],
    [ref(preloadTest, `preload ${channel} forwards no renderer arguments and preserves replies and rejection`,
      'test(`preload ${channel} forwards no renderer arguments')],
    `Bridge invokes exactly ${channel} without renderer-supplied arguments, returns the exact reply and propagates the exact rejected error.`));
  for (const [channel, line] of [['terminal:shutdown-request', 6], ['updates:changed', 23]])
    bindings.push(binding([`channel:${preload}:ipcRenderer.on:${channel}:${line}`], [preload],
      [ref(preloadTest, `preload ${channel} strips Electron event and independently removes listeners`,
        'test(`preload ${channel} strips Electron event')],
      `${channel} forwards only the payload, supports two independent subscriptions and removes only the selected listener with idempotent cleanup.`));
  bindings.push(binding([`channel:${preload}:ipcRenderer.send:terminal:shutdown-response:10`], [preload],
    [ref(preloadTest, 'preload terminal:shutdown-response only accepts literal true confirmation')],
    'Shutdown response preserves request ID and maps only literal true to confirmation; false, string true, number and undefined are false.'));
  bindings.push(binding([`channel:${preload}:ipcRenderer.sendSync:workspace:save-sync:32`], [preload],
    [ref(preloadTest, 'preload workspace:save-sync preserves data and rejects a synchronous main-process error')],
    'Synchronous workspace save transmits the exact fixture object and turns a returned main-process error into a rejected save.'));
  bindings.push(binding([`source:${preload}:${preload}`], [preload], bindings.flatMap((row) => row.tests),
    'All 17 frozen bridge channels satisfy their explicit forwarding, result, error and event-cleanup contracts; no other preload branches are associated.'));
  bindings.push(binding([`channel:${update}:window.webContents.send:updates:changed:27`], [update],
    [ref(preloadTest, 'update IPC broadcasts exact state only to a live current-origin window and stops after disposal')],
    'State events send the exact updates:changed payload only to a live current-origin window; foreign/invalid URLs, destroyed and absent windows receive nothing; disposal removes handlers and listener.'));
  return { schemaVersion: 1, sha, reviewedTooling: { [preloadTest]: hash(read(preloadTest)) }, bindings };
}

const webLimit = 'Existing exact value/error assertions replayed on committed source through the repository TypeScript loader; scoped unit or SSR fixtures only, not browser interaction, backend parity, full branches or installation acceptance. Type-only exports are not associated.';
export function webPlan() {
  const bindings = [];
  function add(module, names, testFile, tests, assertion, source = false) {
    const file = `apps/web/src/${module}.ts`;
    const references = tests.map((name) => ref(`apps/web/tests/${testFile}.test.mjs`, name));
    const entries = names.map((name) => `export:${file}:${name}`);
    if (source) entries.push(`source:${file}:${file}`);
    bindings.push(binding(entries, [file], references, assertion, webLimit));
  }
  add('components/commit-graph', ['emptyGraph', 'appendGraph'], 'commit-graph', [
    'linear history starts at its tip, joins every parent and stops at its root',
    'merges, octopus merges and disconnected roots retain exactly the unresolved parent targets',
    'every possible page boundary preserves all existing geometry and colors',
  ], 'Graph rows preserve parent edges, unique unresolved lane targets, geometry and colors across each page split without mutating the previous page.', true);
  add('components/commit-graph', ['linearGraph'], 'commit-graph', [
    'filtered results form one dashed chain that stays open while more pages remain',
  ], 'Filtered graph has exactly one dashed chain, keeps the final open edge only when more pages exist and has no edge for a single final row.');
  add('components/find-in-content', ['compileFindPattern', 'findMatches', 'FIND_MATCH_LIMIT'], 'find-in-content', [
    'plain search escapes regex characters and ignores case by default',
    'whole word matching works for plain, regex and non-ASCII words',
    'regex mode combines with case matching and supports loose escapes',
    'invalid regex reports an error instead of throwing',
    'empty regex matches are skipped without looping',
    'match count stops at the VSCode limit',
  ], 'Search returns exact literal/case/word/Unicode/regex matches; invalid regex is data, empty matches terminate and result count truncates at the declared limit.', true);
  add('components/find-in-content', ['nearestMatchIndex'], 'find-in-content', [
    'refreshed results keep the nearest match after the previous position',
  ], 'Nearest search index handles empty results, missing cursor, between-unit/within-unit positions and positions after the final match.');
  add('components/files-git-status', ['fileStatusIndex', 'fileDecoration'], 'files-git-status', [
    'changed states have distinct text badges; ignored files have only a color and label',
    'mixed index/worktree records use deterministic priorities, preserving staged additions',
    'directories summarize descendants without coloring clean siblings or rename sources',
    'literal paths and directory records do not leak decorations across path boundaries',
  ], 'Exact status badges, deterministic conflict/staged priorities and directory summaries respect literal path and directory boundaries.', true);
  add('components/files-git-status', ['filesStatusRevision'], 'files-git-status', [
    'new snapshots remove stale colors and identical/reordered polls have stable revisions',
  ], 'Identical/reordered file snapshots retain revision while changed status changes it; empty snapshots remove stale direct and descendant indexes.');
  add('components/files-tree', ['treeRows', 'ROOT'], 'files-view', [
    '只展开的目录会被读取，未加载的子目录显示读取中并交给视图加载',
    '根目录的读取中和失败不生成树行，由视图整体显示',
    '单个目录失败、为空或被截断时只在该目录下提示，不影响兄弟节点',
    '刷新时保留旧列表，刷新失败也继续显示旧内容',
    '符号链接、子模块和特殊文件不可展开，即使同名路径被标记为展开',
  ], 'File tree returns exact rows and pending paths for expanded/loading/error/empty/truncated/stale directories and does not expand symlinks or submodules.', true);
  add('components/files-tree', ['visibleDirectories', 'parentOf'], 'files-view', [
    '可见目录只包含根和展开且其父级也可见的目录',
  ], 'Visible paths include only root and expanded descendants of visible parents; parent extraction handles nested and root files.');
  add('components/files-tree', ['errorStatus', 'errorMessage'], 'files-view', [
    '错误信息优先使用服务端返回的说明和状态码',
  ], 'Error projection preserves server status/message, falls back to Error.message and then fallback text without manufacturing a status.');
  add('components/file-language', ['fileLanguage'], 'files-view', [
    '按文件名和扩展名识别语言，未知类型按纯文本处理',
  ], 'Known literal file names and case-insensitive extensions map to exact language IDs; unknown text/license/archive names return null.', true);
  add('components/syntax-highlight', ['highlight'], 'files-view', [
    '语法高亮生成 React 元素而不是 HTML 字符串，未知语法返回 null',
  ], 'Syntax highlighting returns React token nodes with exact keyword/number classes and escaped comment markup; unknown grammar returns null.', true);
  add('components/conflict-model', ['operationTitle', 'operationProgress', 'sideNames'], 'merge-conflicts', [
    '操作标题、进度与双方含义按操作类型区分',
  ], 'Merge/rebase/cherry-pick titles, progress and current/incoming semantics match explicit expected strings.', true);
  add('components/conflict-model', ['hasConflictBlocks', 'wholeFileActions'], 'merge-conflicts', [
    '删除/修改与重命名冲突只提供整文件操作，删除操作被标记',
  ], 'Conflict kinds determine text-block availability and exact whole-file actions, side labels and deletion flags.');
  add('components/conflict-model', ['contextExcerpt'], 'merge-conflicts', [
    '冲突之间的未改动内容只保留相邻几行',
  ], 'Context excerpt preserves exact neighboring head/tail text and omitted-line counts.');
  add('stores/workspaceLayout', ['DEFAULT_LAYOUT', 'readLayoutPreferences'], 'workspace-layout', [
    'layout validates old, malformed and out-of-range preferences',
  ], 'Invalid preferences yield the default layout; old/out-of-range values are clamped and infinite input falls back to the default width.', true);
  add('stores/workspaceLayout', ['fitWorkspaceLayout'], 'workspace-layout', [
    'window fitting preserves inspector space without replacing saved preferences',
    'all panel combinations fit without spending space on a hidden sidebar',
  ], 'Layout fitting preserves inspector width and stored preferences, switches at the compact boundary and correctly accounts for every collapsed-panel combination.');
  add('stores/commitDraftStore', ['useCommitDraftStore'], 'workspace-layout', [
    'commit drafts are isolated by repository and late submission completion preserves newer text',
  ], 'Repository drafts remain isolated; late completion cannot clear newer text while matching submitted drafts are removed.', true);
  add('stores/terminalHistory', ['retainedTerminalLines'], 'terminal-history', [
    'terminal history counts UTF-8 and retains newest lines within both bounds',
  ], 'Newest terminal history respects UTF-8 byte and line limits including multibyte Chinese and combining characters.', true);
  add('stores/terminalState', ['useTerminalStore'], 'terminal-history', [
    'terminal selection is remembered independently for repositories and hiding preserves sessions',
  ], 'Terminal selection stays keyed by repository and toggling visibility preserves both sessions.', true);
  add('stores/repositoryLabels', ['repositoryPathLabels', 'worktreeKindLabel'], 'repository-labels', [
    'same-name directories get unique suffixes without inferring worktree identity',
    'suffixes expand through repeated parents and stay scoped to their host',
    'Windows and literal POSIX paths remain distinguishable',
  ], 'Repository path suffixes distinguish exact host/path identities without inferring worktree kinds; kind labels preserve unknown values as undefined.', true);
  add('stores/repositoryLabels', ['repositoryWorkspaceLabels'], 'repository-labels', [
    'compact workspace identities distinguish the main checkout and multiple worktrees',
    'removing repeated directory names does not reintroduce collisions',
    'compact labels respect Windows drives, POSIX backslashes and host boundaries',
    'nested registrations remain distinct when the parent shares the repository name',
  ], 'Compact labels remain unique, stable under order/branch changes and correct for nested, Windows, POSIX and cross-host paths.');
  add('stores/repositoryLabels', ['repositoryAccessibleName'], 'repository-labels', [
    'accessible identities include the type, host and original path without guessing unknown kinds',
  ], 'Accessible repository names contain the exact known worktree label, host and literal original path without inventing an unknown kind.');
  add('components/diff-lines', ['getNumberedDiffLines', 'getDiffChangeSegments'], 'diff-change-navigation', [
    'each run of added/removed lines is one stop, including several per hunk',
  ], 'Numbered diff rows yield exact change-run indexes across multiple edits/hunks and missing-newline markers; empty diff has no stops.', true);
  add('stores/workspaceLayout', ['SIDEBAR_MIN', 'SIDEBAR_MAX', 'CHANGES_MIN', 'CHANGES_MAX',
    'INSPECTOR_MIN', 'FILES_TREE_MIN', 'FILES_TREE_MAX', 'FILES_STACKED_WIDTH', 'RESIZE_WIDTH',
    'COMPACT_WIDTH', 'clampWidth'], 'p0-helper-boundaries', [
    'P0 layout dimensions and clamp rounding preserve exact frozen boundaries',
  ], 'Exact frozen dimensions and below/at/above-boundary plus fractional rounding inputs preserve declared layout limits.');
  add('components/commit-graph', ['GRAPH_ROW_HEIGHT', 'GRAPH_LANE_WIDTH'], 'p0-helper-boundaries', [
    'P0 commit graph dimensions retain exact frozen pixel constants',
  ], 'Graph rows remain 36 pixels high and lanes 18 pixels wide.');
  add('components/files-git-status', ['FILE_DECORATIONS'], 'p0-helper-boundaries', [
    'P0 file decorations preserve the complete status badge and label vocabulary',
  ], 'All eight status badges and Chinese labels equal the explicit frozen vocabulary.');
  add('components/conflict-model', ['conflictKindLabels', 'conflictHint', 'operationNames', 'shortHash', 'conflictedFiles'], 'p0-helper-boundaries', [
    'P0 conflict labels hints short hashes and conflict selection preserve exact values',
  ], 'Exact seven-kind labels and hints, four operation names, empty/short/long hashes, and nonmutating conflict-only file selection match frozen values.');
  add('stores/terminalState', ['terminalStateLabel'], 'p0-helper-boundaries', [
    'P0 terminal and connection labels distinguish live failed unknown and exited states',
  ], 'All terminal state labels and exit-code/signal/missing-signal variants match exact strings.');
  add('stores/connectionStatus', ['connectionStatus', 'connectionStatusLabel'], 'p0-helper-boundaries', [
    'P0 terminal and connection labels distinguish live failed unknown and exited states',
  ], 'Missing connection status defaults to unknown and all five statuses retain exact labels.', true);
  add('stores/sidebarOrder', ['horizontalPlacement', 'orderedIds', 'orderItems', 'canMoveTreeItem', 'moveBeforeOrAfter'], 'p0-helper-boundaries', [
    'P0 sidebar placement and ordering preserve host ownership and immutable stable ordering',
  ], 'Midpoint placement, missing/duplicate saved IDs, object identity, host-boundary move permission, both move directions and immutable no-op cases match explicit expectations.', true);
  const boundaryTest = 'apps/web/tests/p0-helper-boundaries.test.mjs';
  return { schemaVersion: 1, sha, nodeImports: ['apps/web/tests/resolve-ts.mjs'],
    reviewedTooling: { [boundaryTest]: hash(read(boundaryTest)) }, bindings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ledgerFile, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: p0-followup-plans.mjs LEDGER NEW_OUTPUT_DIRECTORY');
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  validateLedger(ledger);
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== sha)
    throw Error('Assertion bindings require review at the actual HEAD');
  const plans = { preload: preloadPlan(), web: webPlan() };
  for (const plan of Object.values(plans)) validateBindings(ledger, plan);
  fs.mkdirSync(output, { recursive: false });
  for (const [label, plan] of Object.entries(plans)) {
    fs.writeFileSync(path.join(output, label + '.json'), JSON.stringify(plan, null, 2) + '\n');
    console.log(label + ': ' + new Set(plan.bindings.flatMap((row) => row.entries)).size + ' explicit IDs');
  }
}

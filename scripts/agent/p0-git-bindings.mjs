// Manually reviewed frozen ssh-client IDs -> committed Agent assertions.
// This is an allowlist, NOT an import/call/coverage-derived method inventory.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateBindings, validateLedger, verifyInput } from './p0-test-receipts.mjs';

export const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
export const baseline = '3c05f640fcc1a04c864e47bfc2880483ad48c984';
const root = fileURLToPath(new URL('../../', import.meta.url));
const archive = 'docs/acceptance/issue-257-258/8f30e6b/';
const oldFile = (module) => `packages/ssh-client/src/${module}.ts`;
const current = (module) => `packages/agent/src/modules/git/${module}.ts`;
const ssh = (module) => `packages/agent/src/adapters/ssh/${module}.ts`;
const test = (module, name, line) => ({ file: `packages/agent/tests/git-${module}.test.cjs`, name, line });
// Only the literal selectors below become IDs; source/export never imply methods.
function binding(module, selectors, implementation, tests, assertion, limitations) {
  const file = oldFile(module);
  return {
    entries: selectors.map((selector) => {
      const [kind, name] = selector.split(':');
      return `${kind}:${file}:${kind === 'source' ? file : name}`;
    }),
    implementation, tests, assertion,
    limitations: limitations + ' Source/class-export association is limited to these stated assertions, not all methods, constructors, branches, platforms or release acceptance. No shared-model IDs are counted.',
  };
}

export const reviewedBindings = [
  binding('change-entries', ['source', 'export:ignoreDirectory'],
    [current('change-entries'), current('change-entries-writes')],
    [test('change-entries', 'local: classify, stage, discard and locally ignore directory entries without traversing them', 24),
      test('change-entries', 'ignore rules escape metacharacters, use the common Git directory, and reject unrelated paths', 203)],
    'Frozen change-entries.ts ignoreDirectory moved to change-entries-writes.ts: assertions at 95-105 and 211-229 check exact escaped exclude patterns, disappearance from status, common worktree metadata and rejection of unrelated paths. Classification results at 41-59 demonstrate the source responsibility only.',
    'Local disposable repositories; classifyChanges and specialChangeReason exports are NOT inferred from status/discard calls.'),
  binding('change-entries', ['export:assertFileChanges'], [current('change-entries')],
    [test('change-entries', 'tracked submodules retain pointer previews/staging and are excluded from file discard/deletion', 146),
      test('change-entries', 'directory-to-file replacements stage without deleting working contents; file checkout remains guarded', 232)],
    'assertFileChanges retained its implementation in the read module and is re-exported by the writes module. Direct rejects at 167 and 241 assert submodule and directory-to-file checkout guards; staged pointer and replacement contents remain intact.',
    'Only the directly rejected cases; no claim for every path-validation branch.'),
  binding('channel-queue', ['source', 'export:SSHChannelQueue'], [ssh('channel-queue'), ssh('connection-manager')],
    [test('channel-queue', 'streaming, buffered commands and SFTP share slots until their channels close', 33),
      test('channel-queue', 'cancelled queued commands never execute; cancelled opens retain their slot until close', 60)],
    'Frozen SSHChannelQueue is byte-identical at adapters/ssh/channel-queue.ts. Observable assertions at 42-57 and 78-92 prove four shared slots, retained reservations until close, FIFO advancement and no execution of a cancelled queued command through SSHConnection.',
    'Queue source/class responsibility only, via mocked SSH channels. No direct queue open/close/pump assertions exist here, so NONE of those method IDs are associated.'),
  binding('connection-manager', ['source', 'export:SSHConnection', 'method:SSHConnection.execCommand', 'method:SSHConnection.execCommandStream', 'method:SSHConnection.withSftp'],
    [ssh('connection-manager'), ssh('channel-queue')],
    [test('channel-queue', 'streaming, buffered commands and SFTP share slots until their channels close', 33),
      test('status', 'UTF-8 survives split SSH packets and invalid text can be rejected for previews', 66),
      test('channel-queue', 'SFTP cancellation closes active sessions and retains the slot until close', 173)],
    'Frozen SSHConnection command/SFTP methods moved to adapters/ssh/connection-manager.ts (execCommand 366, execCommandStream 535, withSftp 582). Direct assertions check streamed progress, buffered exit codes, SFTP result/session close, UTF-8 decoding/rejection and cancellation task accounting.',
    'Mocked established connection, not authentication, credentials, real-host trust, reconnect, pools or emitted connection channels. Type-only options/results/callbacks are excluded.'),
  binding('connection-manager', ['method:SSHConnection.disconnect'], [ssh('connection-manager'), ssh('channel-queue')],
    [test('channel-queue', 'disconnect rejects queued and opening work and disposes late channels', 112)],
    'disconnect remains the explicit shutdown operation at adapter line 184. Assertions 114-129 prove all queued/opening promises reject, late channels close, no new channels open and disconnected exec/SFTP are refused.',
    'Mock transport shutdown only; clearForwarding and other internal methods are not credited.'),
  binding('conflict-resolution', ['source', 'export:ConflictResolution', 'method:ConflictResolution.state', 'method:ConflictResolution.unmerged', 'method:ConflictResolution.resolveFile', 'method:ConflictResolution.resolveBlock', 'method:ConflictResolution.continue'],
    [current('conflict-resolution'), current('conflict-resolution-writes')],
    [test('conflict-resolution', 'local: merge conflicts report kinds, resolve per block and continue', 61)],
    'Old state moved to GitOperationReads.state, inherited by ConflictResolution in conflict-resolution-writes.ts; unmerged/resolveFile/resolveBlock/continue moved to the writes subclass. Assertions 68-106 check operation metadata, stale block rejection, exact rewritten text, unmerged stage counts, incoming deletion, successful continue and two-parent merge.',
    'Local real-Git merge case only. Error export, required and step helpers are not credited; no general operation-state equivalence claim.'),
  binding('conflict-resolution', ['method:ConflictResolution.skip', 'method:ConflictResolution.abort'],
    [current('conflict-resolution'), current('conflict-resolution-writes')],
    [test('conflict-resolution', 'local: rebase reports progress, stops again on the next conflict, skips and aborts', 111)],
    'skip/abort bodies moved to the writes subclass. Direct assertions 142-151 check skip result, cleared operation state, expected HEAD after skip, original feature HEAD after abort, and clean worktree.',
    'Only a disposable local two-commit rebase; internal step/required remain unassociated.'),
  binding('diff-images', ['source', 'export:DiffImages', 'export:DiffImageAbsentError', 'method:DiffImages.read'],
    [current('diff-images')],
    [test('diff-images', 'commit previews return both sides of a modified image and report added/deleted sides', 56),
      test('diff-images', 'worktree and index previews stay on their own side without touching the repository', 101)],
    'DiffImages.read and DiffImageAbsentError migrated to modules/git/diff-images.ts; read adds invalid-reference guards beyond the frozen implementation. Assertions 68-97 compare exact PNG bytes/media type and instanceof absent-side errors; 113-130 distinguish HEAD/index/worktree without changing index or disk.',
    'Loopback fixture SSH only. Internal git/revisions/readBlob/readWorktree methods and base DiffImageError are not credited. New reference guards and LFS branches are not claimed.'),
  binding('discard-changes', ['source', 'export:DiscardChanges', 'method:DiscardChanges.preview', 'method:DiscardChanges.discard'],
    [current('discard-changes')],
    [test('discard-changes', 'all: preserves the index and staged new files with existing HEAD', 33),
      test('discard-changes', 'rejects stale confirmation after content changes, without any writes', 148),
      test('discard-changes', 'returns actual partial results and preserves the index after a permission failure', 223)],
    'DiscardChanges preview/discard bodies are retained; disk hashing now uses readSftpChunks rather than createReadStream. Assertions 49-70 check preview counts, no preview writes, exact restored/deleted outcomes and index preservation; 164-167 reject stale token without writes; 241-258 verify partial failure/retry.',
    'Disposable local repositories and injected permission failure; no internal git/state/targets/validateTarget/disk/inspect method or error/validator export is inferred.'),
  binding('git-blame', ['source', 'export:GitBlame', 'method:GitBlame.read', 'method:GitBlame.commit'],
    [current('git-blame')],
    [test('blame', 'local: blame matches Git, follows renames, maps parent lines, and supports worktrees', 12)],
    'GitBlame bodies are retained with domain import substitution. Direct read/commit assertions 38-69 compare blame hashes against Git, rename parent path/content/focus line, full commit body and linked-worktree lines.',
    'Local Git only; parseBlame export, deadline/git/readVersion internal methods are not credited from the public read call.'),
  binding('git-blame', ['export:parentLine'], [current('git-blame')],
    [test('blame', 'parent line mapping handles insertions, deletions, replacements and unchanged offsets', 150)],
    'parentLine is the retained exported mapping function. Direct deepEqual assertions 151-154 check insertion/deletion offsets, inexact replacement mapping and unchanged positions.',
    'Four literal patch-header cases, not arbitrary diff correctness.'),
  binding('git-commands', ['source', 'export:GitCommands', 'method:GitCommands.status'],
    [current('git-commands'), current('git-commands-writes')],
    [test('status', 'UTF-8 paths remain exact when SSH splits a character across chunks', 20),
      test('status', 'a cancelled status closes only its channel; other repository commands still complete', 30),
      test('status', 'only explicit foreground status permits saving refreshed index metadata', 114)],
    'Old GitCommands.status now lives in GitReads and is inherited by GitCommands writes subclass. Direct assertions 27, 42-52 and 128-130 check exact Unicode path, per-command cancellation isolation, branch/ahead/behind and foreground-only optional lock policy.',
    'Mock SSH command responses, not all status record variants. No private parser/validator/_git/_changeIndex methods are inferred.'),
  binding('git-commands', ['method:GitCommands.stage', 'method:GitCommands.unstage', 'method:GitCommands.diff'],
    [current('git-commands'), current('git-commands-writes')],
    [test('change-entries', 'tracked submodules retain pointer previews/staging and are excluded from file discard/deletion', 146),
      test('change-entries', 'directory-to-file replacements stage without deleting working contents; file checkout remains guarded', 232)],
    'stage/unstage moved to git-commands-writes.ts; diff remains inherited from GitReads (with new guards/speculative read scheduling). Direct assertions 164-177 compare submodule pointer previews before/after staging and unstaged status; 242-244 assert replacement index path and preserved bytes.',
    'Only local submodule pointer and directory replacement scenarios. No complete diff-preview limit, history, branch or parser acceptance.'),
  binding('git-commands', ['method:GitCommands.commit'], [current('git-commands'), current('git-commands-writes')],
    [test('staged-changes', 'commits quotes, literal shell expressions and actual newlines without expansion', 68)],
    'commit body moved to git-commands-writes.ts. Direct assertions 76-80 check zero exit code, exact multiline message in git log, absent shell-expansion sentinel and retained unstaged file.',
    'Unsigned local commit only, not amend/signing/error branches.'),
  binding('git-commands', ['method:GitCommands.log'], [current('git-commands'), current('git-commands-writes')],
    [test('tags', 'local: real Git tag create, history, single/all push, checkout and confirmed deletion', 13)],
    'log remains a GitReads method inherited by GitCommands. Assertion 61-63 calls log directly and checks a literal Unicode/metacharacter tag reference in commit history.',
    'Only reference decoration in local history; pagination/filter/revision correctness is not claimed.'),
  binding('git-commands', ['method:GitCommands.remoteList'], [current('git-commands'), current('git-commands-writes')],
    [test('remotes', 'remote discovery reads real Git config from a quoted path and keeps fetch/push destinations separate', 6)],
    'remoteList remains inherited from GitReads. Exact deepEqual at 19-30 checks separate fetch/push destinations and fallback push URL; 31 checks unchanged status.',
    'URLs are inert fixture config strings; no connection to GitHub/GitLab or real credentials. Other GitCommands read methods remain unassociated.'),
  binding('git-shell', ['source', 'export:gitFileCommand'], [current('git-shell')],
    [test('git-shell', 'Windows SSH receives encoded literal arguments and relays raw Git output', 6)],
    'Frozen git-shell.ts is byte-identical in Agent. Direct assertions 14-24 decode gitFileCommand output and check literal Windows path/argument encoding, no shell execution and raw stdout/stderr relay script.',
    'Pure generated-script inspection on this host, NOT execution on Windows. isWindowsPath and quotePosixArgument are not credited from their use inside gitFileCommand.'),
  binding('git-status', ['source'], [current('git-status'), current('git-commands')],
    [test('status', 'a cancelled status closes only its channel; other repository commands still complete', 30)],
    'git-status.ts parser body is unchanged except type-only domain import. Explicit status result assertions 49-52 demonstrate source responsibility for files/branch/ahead/behind after the literal porcelain response at 46.',
    'Source responsibility only through GitReads.status. parseStatus is not directly invoked by this test, so its export ID is deliberately NOT associated; StatusRecord is type-only.'),
  binding('git-tags', ['source', 'export:GitTags', 'method:GitTags.list', 'method:GitTags.remoteTags', 'method:GitTags.create', 'method:GitTags.push', 'method:GitTags.delete', 'method:GitTags.checkout'],
    [current('git-tags'), current('git-tags-writes')],
    [test('tags', 'local: real Git tag create, history, single/all push, checkout and confirmed deletion', 13),
      test('tags', 'changed references, different push URLs, rejection and offline reads preserve local tags', 130)],
    'Frozen GitTags split into GitTagReads (list/remoteTags) and GitTags writes subclass (create/push/delete/checkout). Direct assertions 49-59, 80-86, 89-125 check metadata/order, exact pushed refs, dirty-worktree protection, detach/new branch and confirmation deletion; 143-177 check stale refs, rejected push/deletion and offline local preservation.',
    'All remotes are temporary bare repositories; no external hosts/credentials. Unsigned fixture tags only; checked/ref/snapshot/remoteUrl helpers are not inferred.'),
  binding('new-file-deletion', ['source', 'export:NewFileDeletion', 'method:NewFileDeletion.preview', 'method:NewFileDeletion.delete'],
    [current('new-file-deletion')],
    [test('new-file-deletion', 'deletes only the selected mixed file (existing HEAD)', 18),
      test('new-file-deletion', 'a lost acknowledgement after clearing the index reports an unknown result', 192)],
    'NewFileDeletion preview/delete bodies retained with port/domain type substitutions. Assertions 29-52 check exact preview state, no preview writes, selected disk/index removal, neighbouring staged blob preservation and no shell sentinel; 210-215 check explicit unknown outcome after injected lost acknowledgement.',
    'Local disposable repositories only; git/disk/inspect/outcome helpers, validator and error export remain unassociated.'),
  binding('partial-changes', ['source', 'export:PartialChanges', 'method:PartialChanges.preview', 'method:PartialChanges.apply'],
    [current('partial-changes'), current('partial-changes-writes')],
    [test('partial-changes', 'local: hunk stage / unstage / discard preserve other hunks and both diff sides', 66),
      test('partial-changes', 'rejects unsafe selection, missing confirmation, stale worktree/index/HEAD and late edits', 191)],
    'Frozen PartialChanges split into PartialReads.preview and PartialChanges.apply in writes subclass. Tokens now bind canonical worktree identity. Helper apply at 47-58 directly calls preview/apply; assertions 49, 81-89 check revision and precise selected-hunk disk/index bytes; 202-237 check confirmation/selection/stale/late-edit rejection without overwriting newer contents.',
    'Local hunk operations only. No inference for internal git/decode/blob/worktree/snapshot/read, selectedContent or error export; canonical-alias token branch is not asserted here.'),
  binding('repository-analytics', ['source', 'export:collectRepositoryAnalytics'], [current('repository-analytics')],
    [test('repository-analytics', 'local: real Git timestamps, UTC boundaries, empty HEAD, languages and detached HEAD', 16)],
    'collectRepositoryAnalytics body retained with domain import substitution. Direct assertions 28-33, 48-59, 62-83 check unborn/empty state, UTC bucket counts, primary language, bounded/shallow flags and equivalent detached/worktree activity.',
    'Only temporary local repositories and local shallow clone; no external network, repository discovery or all timezone boundaries.'),
  binding('repository-analytics', ['export:primaryLanguage'], [current('repository-analytics')],
    [test('repository-analytics', 'language excludes generated/vendor paths, deduplicates index conflict stages and resolves ties', 87)],
    'primaryLanguage retained. Direct equality assertions 88-93 check deduplication, generated/vendor/type-declaration exclusion, tie break and null unsupported-language result.',
    'Literal path samples only, not comprehensive language classification.'),
  binding('repository-files', ['source', 'export:RepositoryFiles', 'method:RepositoryFiles.list', 'method:RepositoryFiles.read', 'export:RepositoryFileError'],
    [current('repository-files')],
    [test('repository-files', 'directories list lazily with folders first, natural order, links and nested repositories', 66),
      test('repository-files', 'paths outside the worktree, into .git or through links are refused', 164),
      test('repository-files', 'previews text, images, binaries, encodings and size limits explicitly', 192)],
    'RepositoryFiles list/read and RepositoryFileError retained, filesystem types changed to the port. Assertions 81-112 check exact listing/order/kinds; rejectsWith at 44-49 asserts instanceof/statusCode/message for direct list/read refusals at 169-184; 212-255 check exact text/image bytes and explicit binary/encoding/size/FIFO states.',
    'Loopback SSH/SFTP fixture on POSIX, not real hosts. No credit for internal resolve/readCapped/sftp, validateRepositoryPath or resolveRepositoryDirectory exports.'),
  binding('repository-files', ['export:decodeTextPreview'], [current('repository-files')],
    [test('repository-files', 'text decoding sniffs binaries like Git and keeps UTF-16 apart from NUL bytes', 292)],
    'decodeTextPreview retained. Direct assertions 293-300 check NUL binary sniffing, UTF-16LE BOM decoding, unsupported big-endian/partial UTF-8 and the bounded NUL scan.',
    'Small literal byte samples; no universal encoding detection claim.'),
  binding('staged-changes', ['source', 'export:StagedChanges', 'method:StagedChanges.read', 'method:StagedChanges.assertRevision'],
    [current('staged-changes')],
    [test('staged-changes', 'reads only staged data with existing HEAD', 11),
      test('staged-changes', 'reads only staged data with unborn HEAD', 11)],
    'StagedChanges bodies retained; CommandOutputLimitError import moved to process port. Direct assertions 21-28 check staged-only diff, exclusion of unstaged/untracked secrets, unchanged index and rejection of old revision after index change.',
    'Local shell fixture with existing/unborn HEAD only; diff/revision internal methods and error export are not credited.'),
  binding('staged-changes', ['export:AI_DIFF_MAX_BYTES'], [current('staged-changes')],
    [test('staged-changes', 'binary metadata, empty index, excessive diff and cancellation have explicit behavior', 31)],
    'The retained runtime AI_DIFF_MAX_BYTES export sizes the fixture at 41; direct read rejection at 43 asserts the exported 96 KiB policy. Binary metadata exclusion and cancellation are also explicitly asserted at 35-44.',
    'One limit-sized input whose patch exceeds the cap; not an exact boundary search or credit for internal diff/revision.'),
  binding('workspace-file-actions', ['source', 'export:WorkspaceFileActions', 'method:WorkspaceFileActions.preview', 'method:WorkspaceFileActions.mutate'],
    [current('workspace-file-actions')],
    [test('workspace-file-actions', 'workspace file actions preserve index and target only the requested file (local)', 11),
      test('workspace-file-actions', 'rejects stale confirmations, overwrite, unsafe boundaries and invalid names', 66)],
    'WorkspaceFileActions preview/mutate retained; Agent adds metadata-name alias guards and a stale-preview error subtype. Assertions 33-61 check preview state, rename/delete exact target and preserved index/staged blobs; 72-100 reject stale/overwrite/unsafe boundaries and preserve symlink target.',
    'Local fixture behavior only; new metadata alias branches and internal git/parent/inspect/guard methods are not credited.'),
  binding('workspace-file-actions', ['export:validateWorkspaceName'], [current('workspace-file-actions')],
    [test('workspace-file-actions', 'rejects stale confirmations, overwrite, unsafe boundaries and invalid names', 66)],
    'Retained validateWorkspaceName now delegates metadata spelling checks to a new helper. Direct assert.throws at 85-86 checks Windows reserved names, trailing characters, stream/separator/wildcard/control input; 87 permits the literal POSIX name.',
    'Pure Windows-policy input validation on this host, not Windows filesystem execution or all new alias guards.'),
  binding('worktrees', ['source', 'export:GitWorktrees', 'method:GitWorktrees.kind', 'method:GitWorktrees.list', 'method:GitWorktrees.resolve'],
    [current('worktrees')],
    [test('worktrees', 'real SSH discovers siblings and isolates staged, unstaged, untracked diffs and writes', 45),
      test('worktrees', 'removed/replaced directories never fall back to a containing or unrelated repository', 118)],
    'GitWorktrees bodies retained with domain import substitution. Direct assertions 54-68 check main/linked kinds, sibling list/current/detached/prunable/locked state and canonical resolve result; 114-115 and 125-132 reject pruned/unlisted/replaced membership.',
    'Only ephemeral loopback SSH/local fixtures; read/root internal methods are not inferred. Sibling write isolation checks do not credit unrelated GitCommands methods.'),
  binding('worktrees', ['method:GitWorktrees.canonicalPath'], [current('worktrees')],
    [test('worktrees', 'SFTP drive paths become native Git paths without rewriting POSIX or UNC paths', 12)],
    'canonicalPath retained. Direct equal at 21 checks /C:/ conversion and literal POSIX backslash/UNC preservation using a fake realpath response.',
    'Synthetic path conversion, not actual Windows SFTP execution.'),
  binding('worktrees', ['export:parseWorktrees', 'export:worktreePathKey'], [current('worktrees')],
    [test('worktrees', 'NUL records preserve literal paths, optional reasons, bare and detached states', 25)],
    'Retained parseWorktrees/worktreePathKey functions are called directly. Assertions 34-42 check literal newline/tab paths, branch/lock/detach/prunable/bare fields, incomplete-record error and Windows-equivalent versus POSIX-distinct path keys.',
    'Literal NUL record/path cases only, not arbitrary record parsing or all platform aliases.'),
];

export const exclusions = [
  '18 frozen modules reviewed; other ssh-client modules are intentionally outside this bounded pass.',
  'No channel ID is added: these tests do not directly assert the frozen connection-pool emitted event contracts.',
  'No type-only export, constructor, unasserted helper, complete-module coverage inference or shared-model ID.',
  'No real credentials, signing keys, SSH agent, credential store or external remote used; fixture SSH is loopback with ephemeral host keys.',
];

function sourceFiles(directory, sourceRoot) {
  return fs.readdirSync(path.join(sourceRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(file, sourceRoot) : file.endsWith('.ts') ? [file] : [];
  }).sort();
}

export function makePlan(ledger, progress) {
  validateLedger(ledger);
  if (progress.currentSha !== sha) throw Error('Expected reviewed current progress SHA');
  const remaining = new Set(progress.rows.filter((row) => row.status !== 'current-scoped-assertion').map((row) => row.id));
  const plan = { schemaVersion: 1, sha, bindings: structuredClone(reviewedBindings) };
  validateBindings(ledger, plan);
  for (const id of plan.bindings.flatMap((row) => row.entries))
    if (!remaining.has(id) || !id.match(/^(source|export|method|channel):packages\/ssh-client\/src\//))
      throw Error('Not a remaining frozen ssh-client ID: ' + id);
  return plan;
}

export function generatePlan({ sourceRoot = root } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: sourceRoot });
  if (git('rev-parse', 'HEAD').toString().trim() !== sha) throw Error('HEAD needs fresh manual review');
  const plan = makePlan(JSON.parse(fs.readFileSync(path.join(sourceRoot, archive + 'ledger.json'))),
    JSON.parse(fs.readFileSync(path.join(sourceRoot, archive + 'missing-progress.json'))));
  // Pin business runtime dependencies too. This enumeration adds INPUT HASHES ONLY,
  // never assertion IDs or inferred capabilities. Dist must be rebuilt before replay.
  const inputs = ['packages/agent/src', 'packages/domain/src', 'packages/protocol/src'].flatMap(dir => sourceFiles(dir, sourceRoot));
  const helpers = ['packages/agent/tests/helpers/local-repository.cjs',
    'packages/agent/tests/helpers/ssh-server.cjs', 'packages/agent/tests/helpers/worktree-repository.cjs'];
  for (const row of plan.bindings) row.implementation = [...new Set([...row.implementation, ...inputs, ...helpers])];
  for (const file of new Set(plan.bindings.flatMap((row) => [...row.implementation, ...row.tests.map((item) => item.file)])))
    verifyInput(file, fs.readFileSync(path.join(sourceRoot, file)), git('show', `${sha}:${file}`), plan);
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output] = process.argv.slice(2);
  if (!output) throw Error('Usage: node scripts/agent/p0-git-bindings.mjs NEW_PLAN_FILE');
  fs.writeFileSync(output, JSON.stringify(generatePlan(), null, 2) + '\n', { flag: 'wx' });
  console.log(output);
}

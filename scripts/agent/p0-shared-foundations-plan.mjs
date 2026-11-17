// Exact source-module scope. Barrels/events are audited, never inferred passed
// from imported or similarly named exports.
export const modules = [
  ['P0-DOMAIN-2238', 'change-actions.ts', 'packages/domain/src/change-actions.ts', 'actions'],
  ['P0-DOMAIN-2242', 'lfs.ts', 'packages/domain/src/lfs.ts', 'lfs'],
  ['P0-DOMAIN-2248', 'merge-conflicts.ts', 'packages/domain/src/merge-conflicts.ts', 'conflicts'],
  ['P0-DOMAIN-2255', 'partial-diff.ts', 'packages/domain/src/partial-diff.ts', 'patches'],
  [
    'P0-DOMAIN-2263',
    'pull-request-lines.ts',
    'packages/protocol/src/pull-request-lines.ts',
    'ranges',
  ],
  ['P0-PROTOCOL-2267', 'types/access-tokens.ts', 'packages/protocol/src/legacy/access-tokens.ts'],
  ['P0-PROTOCOL-2274', 'types/ai.ts', 'packages/protocol/src/legacy/ai.ts'],
  ['P0-PROTOCOL-2283', 'types/blame.ts', 'packages/domain/src/blame.ts', 'constants'],
  ['P0-PROTOCOL-2292', 'types/connection.ts', 'packages/domain/src/connection.ts'],
  ['P0-PROTOCOL-2306', 'types/logging.ts', 'packages/protocol/src/legacy/logging.ts', 'constants'],
  ['P0-PROTOCOL-2313', 'types/proxy.ts', 'packages/protocol/src/legacy/proxy.ts'],
  [
    'P0-PROTOCOL-2320',
    'types/pull-request-center.ts',
    'packages/protocol/src/pull-request-center.ts',
  ],
  ['P0-PROTOCOL-2327', 'types/pull-requests.ts', 'packages/protocol/src/pull-requests.ts'],
  ['P0-PROTOCOL-2353', 'types/rebase.ts', 'packages/domain/src/rebase.ts', 'rebase'],
  [
    'P0-PROTOCOL-2365',
    'types/repository-analytics.ts',
    'packages/domain/src/repository-analytics.ts',
    'constants',
  ],
  ['P0-PROTOCOL-2371', 'types/repository.ts', 'packages/domain/src/repository.ts', 'images'],
  ['P0-PROTOCOL-2421', 'types/tags.ts', 'packages/domain/src/tags.ts'],
  ['P0-PROTOCOL-2428', 'types/terminal.ts', 'packages/domain/src/terminal.ts', 'terminal'],
].map(([scenarioId, frozen, implementation, runtime]) => ({
  scenarioId,
  frozen: 'packages/shared/src/' + frozen,
  implementation,
  runtime,
}));

export const unresolved = [
  ['P0-PROTOCOL-2241', 'packages/shared/src/index.ts'],
  ['P0-PROTOCOL-2299', 'packages/shared/src/types/events.ts'],
  ['P0-PROTOCOL-2305', 'packages/shared/src/types/index.ts'],
].map(([scenarioId, frozen]) => ({
  scenarioId,
  frozen,
  reason:
    'Frozen event declarations are intentionally retired. Existing scoped event successor receipts do not establish complete legacy export compatibility or aggregate module equivalence. No new source-module pass is issued.',
}));

export const runtimeNames = {
  actions: 'P0 shared actions preserve the literal file and directory action matrix',
  lfs: 'P0 shared LFS recognizes complete bounded pointers and rejects malformed documents',
  conflicts: 'P0 shared conflicts preserve bytes and reject stale block selections',
  patches: 'P0 shared partial patches preserve snapshot row IDs and reject incomplete hunks',
  ranges:
    'P0 shared PR ranges reject truncated and cross-file hunks while preserving complete locations',
  constants: 'P0 shared constants retain exact budgets without implying enforcement',
  rebase: 'P0 shared rebase validates complete plans and exact grouping without mutating input',
  images: 'P0 shared image types preserve case normalization and unsupported extensions',
  terminal: 'P0 shared terminal models retain confirmations and public SSH labels',
};

export const limitations =
  'Scoped source-module pure declaration/algorithm assertions on the actual dirty darwin-arm64 working tree. Whole frozen exports are checked bidirectionally with no new any positions, non-import syntax is audited, all runtime exports receive explicit value/input/output/error assertions, and both public package entrypoints load in an I/O-denying VM. DTO compatibility is compile-time only: no RPC, database, Git/provider side effects, physical SSH, UI, install, upgrade, rollback or release acceptance. Retired events and aggregate barrels stay unresolved. PR truncated-hunk refusal is an intentional stricter behavior with a frozen regression witness.';

import type {
  BlameCommitDetail,
  BlameOptions,
  BlameResult,
  BranchInfo,
  CommitFile,
  CommitSignature,
  DiffImageContent,
  DiffImageOptions,
  DiffOptions,
  GitTag,
  LfsStatus,
  LogOptions,
  LogPage,
  PartialDiffPreview,
  RemoteInfo,
  RemoteTag,
  Repository,
  RepositoryAnalytics,
  RepositoryContext,
  RepositoryFilePreview,
  RepositoryStatus,
  RepositoryTreeListing,
  ResourceRef,
  SigningConfig,
  StashEntry,
  SubmoduleInfo,
  WorktreeInfo,
} from '@alune/domain';
import { isRecord, ProtocolError, validId, type JsonValue } from './messages';

export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export type RepositoryResource = Repository & { resource: ResourceRef; pinned: boolean };
export interface RepositorySnapshot {
  resource: ResourceRef;
  gitDirectory: string;
  commonDirectory: string;
  head: string | null;
  indexDigest: string;
  /** HEAD + raw index only. File-specific writes must additionally verify file bytes. */
  revision: string;
}
export interface RepositoryQueryMap {
  status: { params: { foreground?: boolean }; result: RepositoryStatus };
  context: { params: {}; result: RepositoryContext };
  worktrees: { params: {}; result: WorktreeInfo[] };
  branches: { params: {}; result: BranchInfo[] };
  remotes: { params: {}; result: RemoteInfo[] };
  stashes: { params: {}; result: StashEntry[] };
  stashDiff: { params: { index: number }; result: string };
  tags: { params: { remote?: string }; result: { local: GitTag[]; remote?: RemoteTag[] } };
  log: { params: LogOptions; result: LogPage };
  diff: { params: DiffOptions; result: string };
  editableDiff: {
    params: { file: string; staged: boolean; fullFile?: boolean };
    result: PartialDiffPreview;
  };
  diffImage: { params: DiffImageOptions; result: DiffImageContent };
  commitFiles: { params: { commit: string; parentCommit?: string }; result: CommitFile[] };
  tree: { params: { path: string }; result: RepositoryTreeListing };
  file: { params: { path: string }; result: RepositoryFilePreview };
  blame: { params: BlameOptions; result: BlameResult };
  blameCommit: { params: { hash: string }; result: BlameCommitDetail };
  analytics: { params: { endDay: string }; result: RepositoryAnalytics };
  signing: { params: {}; result: SigningConfig };
  signatures: { params: { hashes: string[] }; result: CommitSignature[] };
  submodules: { params: {}; result: SubmoduleInfo[] };
  lfs: { params: {}; result: LfsStatus };
  snapshot: { params: {}; result: RepositorySnapshot };
}
export type RepositoryQueryKind = keyof RepositoryQueryMap;
export type RepositoryQuery = {
  [K in RepositoryQueryKind]: {
    resource: ResourceRef;
    kind: K;
    params: RepositoryQueryMap[K]['params'];
  };
}[RepositoryQueryKind];
export type RepositoryQueryResult<K extends RepositoryQueryKind> = Wire<
  RepositoryQueryMap[K]['result']
>;
export const REPOSITORY_RESULT_MAX_BYTES = 32 * 1024 * 1024;
export const REPOSITORY_CHUNK_BYTES = 32768;
export type RepositoryReadReceipt = {
  resource: ResourceRef;
  kind: RepositoryQueryKind;
  generation: number;
} & ({ value: JsonValue } | { snapshotId: string; bytes: number; chunks: number });
const fields: Record<RepositoryQueryKind, string[]> = {
  status: ['foreground'],
  context: [],
  worktrees: [],
  branches: [],
  remotes: [],
  stashes: [],
  stashDiff: ['index'],
  tags: ['remote'],
  log: [
    'branch',
    'file',
    'follow',
    'author',
    'search',
    'since',
    'until',
    'count',
    'skip',
    'revision',
  ],
  diff: ['file', 'staged', 'commit', 'parentCommit', 'fullFile'],
  editableDiff: ['file', 'staged', 'fullFile'],
  diffImage: ['file', 'staged', 'commit', 'parentCommit', 'fullFile', 'side'],
  commitFiles: ['commit', 'parentCommit'],
  tree: ['path'],
  file: ['path'],
  blame: [
    'path',
    'revision',
    'ignoreWhitespace',
    'useIgnoreRevs',
    'previousLine',
    'expectedVersion',
  ],
  blameCommit: ['hash'],
  analytics: ['endDay'],
  signing: [],
  signatures: ['hashes'],
  submodules: [],
  lfs: [],
  snapshot: [],
};
export function repositoryShape(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((k) => !keys.includes(k)))
    throw new ProtocolError('invalid-params', 'Invalid repository parameters');
}
export function validateResource(value: unknown): ResourceRef {
  repositoryShape(value, ['agentId', 'resourceId']);
  if (!validId(value.agentId) || !validId(value.resourceId))
    throw new ProtocolError('invalid-params', 'Invalid repository resource');
  return value as unknown as ResourceRef;
}
export function repositoryString(value: unknown, empty = false): value is string {
  return (
    typeof value === 'string' &&
    (empty || value.length > 0) &&
    value.length <= 32768 &&
    !value.includes('\0')
  );
}
export function validateRepositoryQuery(value: unknown): RepositoryQuery {
  repositoryShape(value, ['resource', 'kind', 'params']);
  validateResource(value.resource);
  if (typeof value.kind !== 'string' || !Object.hasOwn(fields, value.kind))
    throw new ProtocolError('invalid-params', 'Unknown repository query');
  const kind = value.kind as RepositoryQueryKind;
  repositoryShape(value.params, fields[kind]);
  const p = value.params;
  for (const [key, item] of Object.entries(p)) {
    if (
      ['foreground', 'follow', 'staged', 'fullFile', 'ignoreWhitespace', 'useIgnoreRevs'].includes(
        key,
      )
    ) {
      if (typeof item !== 'boolean') throw new ProtocolError('invalid-params', 'Expected boolean');
    } else if (['since', 'until', 'count', 'skip', 'previousLine', 'index'].includes(key)) {
      if (!Number.isSafeInteger(item) || Number(item) < 0)
        throw new ProtocolError('invalid-params', 'Invalid query range');
    } else if (key === 'hashes') {
      if (
        !Array.isArray(item) ||
        !item.length ||
        item.length > 100 ||
        !item.every((h) => typeof h === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(h))
      )
        throw new ProtocolError('invalid-params', 'Invalid commit hashes');
    } else if (!repositoryString(item, key === 'path' && kind === 'tree'))
      throw new ProtocolError('invalid-params', 'Invalid query text');
  }
  for (const key of (
    {
      editableDiff: ['file', 'staged'],
      tree: ['path'],
      file: ['path'],
      blame: ['path'],
      blameCommit: ['hash'],
      analytics: ['endDay'],
      diffImage: ['file', 'side'],
      commitFiles: ['commit'],
      signatures: ['hashes'],
      stashDiff: ['index'],
    } as Record<string, string[]>
  )[kind] ?? []) {
    if (!(key in p)) throw new ProtocolError('invalid-params', `Missing ${key}`);
  }
  if (kind === 'diffImage' && !['before', 'after'].includes(String(p.side)))
    throw new ProtocolError('invalid-params', 'Invalid image side');
  if (
    kind === 'analytics' &&
    (typeof p.endDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.endDay))
  )
    throw new ProtocolError('invalid-params', 'Invalid analytics day');
  return value as unknown as RepositoryQuery;
}
export function validateRepositoryReceipt(value: unknown): RepositoryReadReceipt {
  if (
    !isRecord(value) ||
    typeof value.kind !== 'string' ||
    !Object.hasOwn(fields, value.kind) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 0
  )
    throw new ProtocolError('invalid-request', 'Invalid repository response');
  validateResource(value.resource);
  if ('snapshotId' in value) {
    if (
      'value' in value ||
      !validId(value.snapshotId) ||
      !Number.isInteger(value.bytes) ||
      Number(value.bytes) < 1 ||
      Number(value.bytes) > REPOSITORY_RESULT_MAX_BYTES ||
      value.chunks !== Math.ceil(Number(value.bytes) / REPOSITORY_CHUNK_BYTES)
    )
      throw new ProtocolError('invalid-request', 'Invalid repository snapshot');
  } else if (!('value' in value))
    throw new ProtocolError('invalid-request', 'Missing repository value');
  return value as unknown as RepositoryReadReceipt;
}
export function validateRepositoryResource(value: unknown): RepositoryResource {
  if (
    !isRecord(value) ||
    !validId(value.id) ||
    !repositoryString(value.path) ||
    !repositoryString(value.name) ||
    !['local', 'ssh'].includes(String(value.source)) ||
    typeof value.pinned !== 'boolean'
  )
    throw new ProtocolError('invalid-request', 'Invalid registered repository');
  const resource = validateResource(value.resource);
  if (resource.resourceId !== value.id)
    throw new ProtocolError('invalid-request', 'Repository identity mismatch');
  return value as unknown as RepositoryResource;
}

export type { ResourceRef } from '@alune/domain';
/** Validate the public result discriminant and essential fields before the UI sees it.
 * JSON envelopes/chunks already enforce finite values and bounded allocation.
 */
export function validateRepositoryValue<K extends RepositoryQueryKind>(
  kind: K,
  value: unknown,
): RepositoryQueryResult<K> {
  const invalid = (): never => {
    throw new ProtocolError('invalid-request', `Invalid ${kind} result`);
  };
  const array = (v: unknown, keys: string[]) =>
    Array.isArray(v) &&
    v.every((item) => isRecord(item) && keys.every((k) => typeof item[k] === 'string'));
  switch (kind) {
    case 'diff':
    case 'stashDiff':
      if (typeof value !== 'string') invalid();
      break;
    case 'branches':
      if (
        !array(value, ['name']) ||
        !(value as Record<string, unknown>[]).every((v) =>
          ['isHead', 'isRemote', 'isCurrent'].every((k) => typeof v[k] === 'boolean'),
        )
      )
        invalid();
      break;
    case 'remotes':
      if (!array(value, ['name', 'fetchUrl', 'pushUrl'])) invalid();
      break;
    case 'stashes':
      if (!array(value, ['message']) || !(value as any[]).every((i) => Number.isInteger(i.index)))
        invalid();
      break;
    case 'worktrees':
      if (
        !array(value, ['path']) ||
        !(value as Record<string, unknown>[]).every((v) =>
          ['detached', 'bare', 'locked', 'prunable', 'isCurrent'].every(
            (k) => typeof v[k] === 'boolean',
          ),
        )
      )
        invalid();
      break;
    case 'commitFiles':
      if (!array(value, ['path', 'status'])) invalid();
      break;
    case 'submodules':
      if (!array(value, ['path', 'status'])) invalid();
      break;
    case 'signatures':
      if (!array(value, ['hash', 'status', 'code', 'signer', 'key'])) invalid();
      break;
    default: {
      if (!isRecord(value)) invalid();
      const v = value as Record<string, unknown>;
      if (
        kind === 'status' &&
        (typeof v.branch !== 'string' ||
          !array(v.files, ['path', 'status']) ||
          !(v.files as Record<string, unknown>[]).every((f) => typeof f.staged === 'boolean') ||
          !Number.isFinite(v.ahead) ||
          !Number.isFinite(v.behind))
      )
        invalid();
      if (
        kind === 'context' &&
        (typeof v.path !== 'string' ||
          !isRecord(v.author) ||
          !Array.isArray(v.remotes) ||
          typeof v.shallow !== 'boolean')
      )
        invalid();
      if (
        kind === 'log' &&
        (!array(v.commits, ['hash', 'message']) ||
          typeof v.revision !== 'string' ||
          typeof v.hasMore !== 'boolean' ||
          !Number.isSafeInteger(v.nextSkip))
      )
        invalid();
      if (
        kind === 'tree' &&
        (typeof v.path !== 'string' ||
          !array(v.entries, ['path', 'name', 'kind']) ||
          !Number.isInteger(v.total))
      )
        invalid();
      if (
        kind === 'file' &&
        (typeof v.path !== 'string' ||
          ![
            'text',
            'image',
            'binary',
            'lfs',
            'symlink',
            'other',
            'too-large',
            'unsupported-encoding',
          ].includes(String(v.kind)))
      )
        invalid();
      if (
        kind === 'diffImage' &&
        (typeof v.content !== 'string' ||
          typeof v.path !== 'string' ||
          typeof v.mediaType !== 'string' ||
          !['before', 'after'].includes(String(v.side)))
      )
        invalid();
      if (kind === 'editableDiff' && typeof v.diff !== 'string') invalid();
      if (
        kind === 'tags' &&
        (!array(v.local, ['name', 'objectHash']) ||
          (v.remote !== undefined && !array(v.remote, ['name', 'objectHash'])))
      )
        invalid();
      if (kind === 'blame') {
        if (typeof v.path !== 'string' || !['ready', 'unavailable'].includes(String(v.kind)))
          invalid();
        if (v.kind === 'unavailable' && typeof v.message !== 'string') invalid();
        if (
          v.kind === 'ready' &&
          (typeof v.content !== 'string' ||
            typeof v.version !== 'string' ||
            !array(v.lines, ['hash', 'path']) ||
            !isRecord(v.commits) ||
            typeof v.ignoreRevsApplied !== 'boolean')
        )
          invalid();
      }
      if (
        kind === 'blameCommit' &&
        (typeof v.hash !== 'string' ||
          typeof v.body !== 'string' ||
          typeof v.message !== 'string' ||
          !Array.isArray(v.parents))
      )
        invalid();
      if (kind === 'lfs' && (typeof v.installed !== 'boolean' || typeof v.used !== 'boolean'))
        invalid();
      if (kind === 'file') {
        if (['text', 'image'].includes(String(v.kind)) && typeof v.content !== 'string') invalid();
        if (v.kind === 'text' && !['utf-8', 'utf-16le', 'utf-16be'].includes(String(v.encoding)))
          invalid();
        if (v.kind === 'image' && typeof v.mediaType !== 'string') invalid();
        if (v.kind === 'symlink' && typeof v.target !== 'string') invalid();
        if (v.kind === 'lfs' && (typeof v.oid !== 'string' || typeof v.message !== 'string'))
          invalid();
        if (
          !['symlink', 'other'].includes(String(v.kind)) &&
          (!Number.isSafeInteger(v.size) || Number(v.size) < 0)
        )
          invalid();
      }
      if (
        kind === 'analytics' &&
        (!Array.isArray(v.daily) ||
          v.daily.length !== 180 ||
          !v.daily.every((n) => Number.isInteger(n) && Number(n) >= 0) ||
          typeof v.endDay !== 'string')
      )
        invalid();
      if (
        kind === 'signing' &&
        (typeof v.enabled !== 'boolean' ||
          typeof v.signingKey !== 'string' ||
          typeof v.format !== 'string')
      )
        invalid();
      if (kind === 'snapshot') {
        validateResource(v.resource);
        if (
          typeof v.indexDigest !== 'string' ||
          typeof v.revision !== 'string' ||
          typeof v.commonDirectory !== 'string'
        )
          invalid();
      }
    }
  }
  return value as RepositoryQueryResult<K>;
}

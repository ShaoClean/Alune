import type {
  CheckoutTagOptions,
  CreateTagOptions,
  DeleteTagOptions,
  PartialDiffRequest,
  PushTagOptions,
  RebaseRequest,
  RebaseResolution,
  ResourceRef,
  SigningConfig,
} from '@alune/domain';
import { isRecord, ProtocolError } from './messages';
import { repositoryShape, validateResource } from './repositories';

// Positional fields mirror the existing Git actions. null is the wire spelling
// for an omitted optional argument before another supplied argument.
const signatures = {
  writeFile: ['text', 'content', 'token'],
  stage: ['paths'],
  unstage: ['paths'],
  checkout: ['paths'],
  commit: ['text', 'text?', 'text?'],
  saveAuthor: ['text', 'text'],
  saveSigningConfig: ['signing'],
  partialDiff: ['partial'],
  mutateWorkspaceFile: ['text', 'text', 'delete|rename', 'text?'],
  deleteNewFile: ['text', 'text'],
  discardChanges: ['text', 'tracked|all'],
  ignoreDirectory: ['text'],
  submodules: ['sync|update'],
  push: ['text?', 'text?', 'bool?', 'bool?', 'bool?'],
  pull: ['text?', 'text?', 'text?', 'text?', 'text?'],
  fetch: ['text?'],
  backgroundFetch: [],
  deepen: ['text?'],
  addRemote: ['text', 'text'],
  createTag: ['createTag'],
  deleteTag: ['deleteTag'],
  pushTag: ['pushTag'],
  checkoutTag: ['checkoutTag'],
  createBranch: ['text', 'bool?'],
  switchBranch: ['text', 'text?', 'bool?'],
  renameBranch: ['text', 'text'],
  deleteBranch: ['text', 'bool?'],
  merge: ['text'],
  rebase: ['text'],
  stash: ['text?', 'bool?'],
  stashPop: ['index?'],
  stashApply: ['index?'],
  stashDrop: ['index?'],
  reset: ['soft|mixed|hard', 'text?'],
  cherryPick: ['paths'],
  revert: ['text'],
  continueOperation: [],
  skipOperation: [],
  abortOperation: [],
  resolveConflictFile: ['text', 'current|incoming'],
  resolveConflictBlock: ['text', 'index', 'current|incoming|both', 'text'],
  startRebase: ['rebasePlan'],
  controlRebase: ['continue|skip|abort'],
  resolveRebaseConflict: ['resolution'],
  createWorktree: ['text', 'text'],
  removeWorktree: ['text', 'confirmed'],
} as const;
export type RepositoryWriteKind = keyof typeof signatures;
export const isRepositoryWriteKind = (kind: unknown): kind is RepositoryWriteKind =>
  typeof kind === 'string' && Object.hasOwn(signatures, kind);
type Objects = {
  signing: SigningConfig;
  partial: PartialDiffRequest;
  createTag: CreateTagOptions;
  deleteTag: DeleteTagOptions;
  pushTag: PushTagOptions;
  checkoutTag: CheckoutTagOptions;
  rebasePlan: RebaseRequest;
  resolution: RebaseResolution;
};
type Field<S> = S extends keyof Objects
  ? Objects[S]
  : S extends 'text' | 'content' | 'token'
    ? string
    : S extends 'bool'
      ? boolean
      : S extends 'confirmed'
        ? true
        : S extends 'paths'
          ? string[]
          : S extends 'index'
            ? number
            : S extends `${infer A}|${infer B}`
              ? A | Field<B>
              : S;
type Args<T extends readonly string[]> = T extends readonly [
  infer A extends string,
  ...infer B extends string[],
]
  ? A extends `${infer S}?`
    ? [value?: Field<S> | null, ...rest: Args<B>]
    : [value: Field<A>, ...rest: Args<B>]
  : [];
export type RepositoryWriteArgs<K extends RepositoryWriteKind> = Args<(typeof signatures)[K]>;
export interface RepositoryWriteIntent<K extends RepositoryWriteKind = RepositoryWriteKind> {
  resource: ResourceRef;
  kind: K;
  args: RepositoryWriteArgs<K>;
}
export interface RepositoryWriteRequest<
  K extends RepositoryWriteKind = RepositoryWriteKind,
> extends RepositoryWriteIntent<K> {
  operationId: string;
  revision: string;
}
const invalid = (): never => {
  throw new ProtocolError('invalid-params', 'Invalid repository write arguments');
};
const text = (v: unknown) => typeof v === 'string' && !v.includes('\0');
const requiredFields: Record<keyof Objects, string[]> = {
  signing: ['enabled', 'format', 'signingKey'],
  partial: ['file', 'action', 'revision', 'selection'],
  createTag: ['name', 'type'],
  deleteTag: ['name', 'objectHash', 'confirmed'],
  pushTag: ['remote'],
  checkoutTag: ['name', 'objectHash'],
  rebasePlan: ['base', 'token', 'entries', 'acknowledgePublished'],
  resolution: ['path', 'token', 'choice'],
};
const objectFields: Record<keyof Objects, string[]> = {
  signing: ['enabled', 'format', 'signingKey', 'tagEnabled', 'source'],
  partial: ['file', 'action', 'fullFile', 'revision', 'selection', 'confirmed'],
  createTag: ['name', 'target', 'type', 'message'],
  deleteTag: ['name', 'objectHash', 'confirmed', 'remote', 'remoteObjectHash'],
  pushTag: ['remote', 'name', 'all'],
  checkoutTag: ['name', 'objectHash', 'branch', 'confirmed'],
  rebasePlan: ['base', 'token', 'entries', 'acknowledgePublished'],
  resolution: ['path', 'token', 'choice', 'content'],
};
function valid(type: string, v: unknown): boolean {
  if (type.endsWith('?')) return v == null || valid(type.slice(0, -1), v);
  if (Object.hasOwn(objectFields, type)) {
    repositoryShape(v, objectFields[type as keyof Objects]);
    if (!requiredFields[type as keyof Objects].every((key) => Object.hasOwn(v, key))) return false;
    // Domain handlers validate semantics against current Git facts.
    return Object.entries(v).every(([key, item]) => {
      if (
        ['enabled', 'tagEnabled', 'fullFile', 'confirmed', 'all', 'acknowledgePublished'].includes(
          key,
        )
      )
        return typeof item === 'boolean';
      if (key === 'selection')
        return (
          isRecord(item) &&
          Object.keys(item).length === 1 &&
          ['lines', 'hunks'].some(
            (k) =>
              Array.isArray(item[k]) &&
              item[k].length > 0 &&
              item[k].length <= 10000 &&
              item[k].every((index) => Number.isSafeInteger(index) && index >= 0),
          )
        );
      if (key === 'entries')
        return (
          Array.isArray(item) &&
          item.length <= 500 &&
          item.every(
            (entry) =>
              isRecord(entry) &&
              Object.keys(entry).every((k) => ['hash', 'action', 'message'].includes(k)) &&
              text(entry.hash) &&
              ['pick', 'reword', 'squash', 'fixup', 'drop'].includes(String(entry.action)) &&
              (entry.message === undefined || text(entry.message)),
          )
        );
      return text(item);
    });
  }
  if (type === 'token') return v === '' || (typeof v === 'string' && /^[a-f0-9]{64}$/.test(v));
  if (type === 'content') return typeof v === 'string';
  if (type === 'text') return text(v);
  if (type === 'bool') return typeof v === 'boolean';
  if (type === 'confirmed') return v === true;
  if (type === 'paths')
    return Array.isArray(v) && v.length > 0 && v.length <= 10000 && v.every(text);
  if (type === 'index') return Number.isSafeInteger(v) && Number(v) >= 0;
  return typeof v === 'string' && type.split('|').includes(v);
}
export function validateWriteIntent(value: unknown, execute: true): RepositoryWriteRequest;
export function validateWriteIntent(value: unknown, execute?: false): RepositoryWriteIntent;
export function validateWriteIntent(value: unknown, execute = false) {
  repositoryShape(
    value,
    execute
      ? ['resource', 'kind', 'args', 'operationId', 'revision']
      : ['resource', 'kind', 'args'],
  );
  validateResource(value.resource);
  if (!isRepositoryWriteKind(value.kind) || !Array.isArray(value.args)) return invalid();
  const signature = signatures[value.kind],
    args = value.args;
  if (args.length > signature.length || !signature.every((type, i) => valid(type, args[i])))
    return invalid();
  if (
    value.kind === 'pull' &&
    args.length > 2 &&
    (args[0] != null ||
      args[1] != null ||
      typeof args[2] !== 'string' ||
      !args[2] ||
      typeof args[3] !== 'string' ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(args[3]) ||
      typeof args[4] !== 'string' ||
      !args[4])
  )
    return invalid();
  if (
    execute &&
    (!isOperationId(value.operationId) ||
      typeof value.revision !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.revision))
  )
    return invalid();
  return value as unknown as RepositoryWriteRequest;
}
export const isOperationId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);

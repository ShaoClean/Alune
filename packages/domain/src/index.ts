export * from './blame';
export * from './lfs';
export * from './partial-diff';
export * from './repository';
export * from './repository-analytics';
export * from './tags';

// Resource identity is host-scoped. Paths and connection aliases are not IDs.
export interface ResourceRef {
  agentId: string;
  resourceId: string;
}
export * from './rebase';
export * from './merge-conflicts';
export * from './terminal';
export * from './workspace';
export * from './connection';
export * from './change-actions';

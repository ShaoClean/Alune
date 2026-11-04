export * from './lfs';

// Resource identity is host-scoped. Paths and connection aliases are not IDs.
export interface ResourceRef {
  agentId: string;
  resourceId: string;
}

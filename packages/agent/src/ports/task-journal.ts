import type { TaskInfo, TaskQuery } from '@alune/protocol';

/** Receipts contain task metadata only, never parameters, output or credentials. */
export interface TaskJournal {
  start(task: TaskInfo, operationId?: string): void;
  finish(task: TaskInfo): void;
  find(query: TaskQuery): TaskInfo | null;
}

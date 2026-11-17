/** Synchronous transactional SQL port; the runtime owns connection and file lifetime. */
export interface SqlStatement {
  run(...parameters: unknown[]): { changes: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}
export interface SqlDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqlStatement;
  transaction<T>(work: () => T): (() => T) & { immediate(): T };
}

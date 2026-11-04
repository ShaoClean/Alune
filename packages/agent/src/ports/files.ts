export interface FileReadPort {
  read(path: string, options: { signal?: AbortSignal; maxBytes: number }): Promise<Buffer>;
}

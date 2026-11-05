export interface TerminalTransport {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  dispose(): void | Promise<void>;
}
export interface TerminalCallbacks {
  data(data: string): void;
  exit(code?: number, signal?: number | string): void;
  disconnect(message: string): void;
}

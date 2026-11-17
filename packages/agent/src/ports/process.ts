/** Native command results stay inside adapters; protocol results are explicit DTOs. */
export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutBytes?: Buffer;
}
export class CommandOutputLimitError extends Error {
  constructor() {
    super('Command output exceeded the preview limit');
  }
}
export interface CommandOptions {
  /** Reliable observation of an already authorized native process. No executor. */
  observe?: (command: { executable: string; args: string[]; cwd: string }) => {
    output(stream: 'stdout' | 'stderr', bytes: Buffer): Promise<void>;
    exit(exitCode: number | null, signal: string | null): Promise<void>;
  };
  onStderr?: (data: string) => void;
  onStdout?: (data: string) => void;
  stdin?: string | Buffer;
  maxOutputBytes?: number;
  strictUtf8?: boolean;
  binary?: boolean;
  environment?: Record<string, string>;
}
export interface GitProcessPort {
  execGit(
    path: string,
    args: string[],
    signal?: AbortSignal,
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

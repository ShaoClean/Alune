import { isRecord, validId } from './messages';

export const COMMAND_TOPICS = ['commands.output', 'commands.exit'] as const;
export interface CommandIdentity {
  commandId: string;
  operationId: string;
  /** Display text only; execution always uses executable + argv without a shell. */
  command: string;
  executable: string;
  args: string[];
  cwd: string;
}
export interface CommandOutput extends CommandIdentity {
  stream: 'stdout' | 'stderr';
  /** Original pipe bytes, including binary data and split UTF-8 sequences. */
  base64: string;
}
export interface CommandExit extends CommandIdentity {
  exitCode: number | null;
  /** null exitCode means termination without a numeric process exit status. */
  signal: string | null;
}
export function isCommandIdentity(p: unknown): p is CommandIdentity {
  return (
    isRecord(p) &&
    validId(p.commandId) &&
    validId(p.operationId) &&
    typeof p.command === 'string' &&
    typeof p.executable === 'string' &&
    typeof p.cwd === 'string' &&
    Array.isArray(p.args) &&
    p.args.every((arg) => typeof arg === 'string')
  );
}
export function isCommandOutput(p: unknown): p is CommandOutput {
  return (
    isCommandIdentity(p) &&
    isRecord(p) &&
    (p.stream === 'stdout' || p.stream === 'stderr') &&
    typeof p.base64 === 'string' &&
    p.base64.length <= 21848 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.base64)
  );
}
export function isCommandExit(p: unknown): p is CommandExit {
  return (
    isCommandIdentity(p) &&
    isRecord(p) &&
    (p.exitCode === null || Number.isSafeInteger(p.exitCode)) &&
    (p.signal === null || typeof p.signal === 'string') &&
    !(p.exitCode !== null && p.signal !== null)
  );
}

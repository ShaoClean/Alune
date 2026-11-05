import type { TerminalSession } from '@alune/domain';

let confirmRemoval: ((sessions: TerminalSession[]) => Promise<boolean>) | undefined;
export function registerTerminalRemovalConfirmation(confirm?: typeof confirmRemoval) {
  confirmRemoval = confirm;
}
export async function confirmTerminalRemoval(sessions: TerminalSession[]) {
  return (await confirmRemoval?.(sessions)) ?? false;
}

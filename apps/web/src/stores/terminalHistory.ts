import { TERMINAL_LIMITS } from '@alune/shared';

// Work backwards so the most recent output survives both limits. The public
// xterm buffer API includes wrapped lines and combined Unicode characters.
export function retainedTerminalLines(
  length: number,
  line: (index: number) => string,
  byteLimit = TERMINAL_LIMITS.historyBytes,
) {
  const encoder = new TextEncoder();
  let bytes = 0;
  let retained = 0;
  for (let index = length - 1; index >= 0 && retained < TERMINAL_LIMITS.historyLines; index--) {
    bytes += encoder.encode(line(index)).length + 1;
    if (bytes > byteLimit) break;
    retained++;
  }
  return retained;
}

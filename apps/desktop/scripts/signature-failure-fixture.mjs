import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Isolated process-failure fixture, never a substitute signature result. Ordinary
// Git commands execute unchanged with the actual Git binary. Apple Git 2.39
// parses invalid gpg.format even for unsigned history, so invalid config cannot
// independently exercise signature-error recovery on that version.
export function signatureFailureFixture(directory) {
  if (process.platform === 'win32') return {};
  const git = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  if (!path.isAbsolute(git)) throw Error('Fixture requires an absolute real Git executable');
  const bin = path.join(directory, 'signature-failure-bin');
  fs.mkdirSync(bin);
  const sentinel = 'alune-test-signature-failure';
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const script = `#!/bin/sh
repo=
previous=
signature=
for argument do
  if [ "$previous" = -C ]; then repo=$argument; fi
  if [ "$argument" = '--format=%H%x00%G?%x00%GS%x00%GK' ]; then signature=1; fi
  previous=$argument
done
if [ "$signature" = 1 ] && [ -n "$repo" ] && [ -f "$repo/.git/${sentinel}" ]; then
  echo 'fatal: controlled-signature-command-failure' >&2
  exit 128
fi
exec ${quote(git)} "$@"
`;
  fs.writeFileSync(path.join(bin, 'git'), script, { mode: 0o700, flag: 'wx' });
  fs.writeFileSync(path.join(bin, 'fixture.json'), JSON.stringify({ git, sentinel, scope: 'Signature command failure only in a disposable marked repository; all other arguments forwarded unchanged.' }, null, 2));
  return { PATH: bin + path.delimiter + process.env.PATH, ALUNE_TEST_SIGNATURE_SENTINEL: sentinel };
}

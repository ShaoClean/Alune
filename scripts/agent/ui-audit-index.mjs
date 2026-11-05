// Regenerate the compact test fixture from the frozen Wiki Issue-249 ledger.
// Only stable IDs and structural fingerprints are embedded in acceptance builds.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: ui-audit-index.mjs LEDGER OUTPUT');
const ledger = JSON.parse(fs.readFileSync(input, 'utf8')),
  callbacks = {};
for (const row of ledger.entries.filter((row) => row.kind.startsWith('ui-'))) {
  const scan = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    row.callback ?? '',
  );
  const tokens = [];
  while (scan.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scan.getTokenText());
  const tag = row.name.replace(/:\d+$/, '');
  const key = createHash('sha256')
    .update(JSON.stringify([row.file, row.kind, tag, tokens]))
    .digest('hex')
    .slice(0, 24);
  (callbacks[key] ??= []).push(row.id);
}
fs.writeFileSync(output, JSON.stringify({ baseline: ledger.sha, callbacks }, null, 2) + '\n');

// Regenerate from the complete, frozen P0 ledger and its exact Git tree.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { auditKey, bindings } from "../../../apps/web/tests/ui-audit-bindings.ts";
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: ui-audit-index.mjs LEDGER OUTPUT');
const ledger = JSON.parse(fs.readFileSync(input, 'utf8'));
if (ledger.sha !== '3c05f640fcc1a04c864e47bfc2880483ad48c984')
  throw Error('Unexpected P0 revision');
const callbacks = {},
  anchors = {},
  files = new Map();
for (const row of ledger.entries.filter((e) => e.kind.startsWith('ui-'))) {
  const key = auditKey(row.file, row.kind, row.name.replace(/:\d+$/, ''), row.callback ?? '');
  (callbacks[key] ??= []).push(row.id);
  if (!files.has(row.file)) files.set(row.file, new Set());
  files.get(row.file).add(row.id);
}
for (const [file, ids] of files) {
  const source = execFileSync('git', ['show', ledger.sha + ':' + file], { encoding: 'utf8' });
  for (const s of bindings(file, source)) {
    if (!ids.has(s.id) || !callbacks[s.key]?.includes(s.id)) continue;
    if (callbacks[s.key].length > 1)
      for (const k of [s.context, s.exact]) (anchors[k] ??= []).push(s.id);
  }
}
// The stash header and empty-state buttons share a callback body. Removing
// the shared panel-error condition changed only the header's nearby tokens.
// Keep its reviewed source anchor distinct from the unchanged empty-state button.
{
  const id = 'ui-handler:apps/web/src/components/StashesView.tsx:Button.onClick:270';
  const oldAnchor = '8c0f0b98527476a195664e68';
  const newAnchor = 'b028575f6c20c3b740dec0a8';
  if (anchors[oldAnchor]?.length !== 1 || anchors[oldAnchor][0] !== id || anchors[newAnchor])
    throw Error('Invalid reviewed stash anchor');
  anchors[newAnchor] = [id];
}
// Changed callback bodies still implement the same UI actions. Pin both
// token fingerprints; future edits must be compared again, never matched by
// name or line alone. These mappings do not constitute execution receipts.
const successors = {};
for (const [id, oldKey, newKey] of [
  // Layout-generated scrolls during restoration do not replace the saved
  // reading position. User scrolling keeps the original cache update action.
  [
    'ui-handler:apps/web/src/components/CodeView.tsx:div.onScroll:100',
    'ad7323a1a364789a6e29c08e',
    'a75e811c0ebf5cd2e01d206b',
  ],
  // A pending remote read can enable an explicit choice; selecting it freezes
  // the loaded object instead of letting later refreshes replace the proof.
  [
    'ui-handler:apps/web/src/components/TagsView.tsx:input.onChange:320',
    '13e0ebe40dbc86a4d3ef1e87',
    '527b9bebaefeab62dcf56332',
  ],
  // Freeze both local and remote delete objects at the confirmation boundary.
  [
    'ui-handler:apps/web/src/components/TagsView.tsx:Button.onClick:267',
    '11fc6ed4e37f31c057d0fe93',
    'd4062902fa9815422681bb5b',
  ],
  [
    'ui-handler:apps/web/src/components/TagsView.tsx:AluneModal.onOk:297',
    '2309b2279f8b40be86c3560b',
    '19e13af7f47cecc460bc7bb9',
  ],
  // Restore trigger focus once the discard dialog has actually closed.
  [
    'ui-handler:apps/web/src/components/ChangesView.tsx:DiscardChangesDialog.onClose:742',
    'c5c9ef03a9eeede4f83ee64c',
    '6ff87960979673c07c7b1c7a',
  ],
  // A trailing tab click is suppressed after dragging; a portaled menu
  // command is not itself a click on the dragged tab.
  [
    'ui-handler:apps/web/src/components/RepositoryTabs.tsx:div.onClickCapture:410',
    '1b2e8f355f857db2c16bc1d4',
    '881d56fdf071d04049598e86',
  ],
  // Cancel exactly the operation displayed in the notice.
  [
    'ui-handler:apps/web/src/components/GitOperationNotice.tsx:FeedbackNotice.onAction:112',
    '6bab6affc04083ee61e6b9ac',
    'ab8f477bfdbf9446a74327ca',
  ],
]) {
  if (callbacks[oldKey]?.length !== 1 || callbacks[oldKey][0] !== id || callbacks[newKey])
    throw Error('Invalid reviewed successor: ' + id);
  successors[newKey] = [id];
}
fs.writeFileSync(
  output,
  JSON.stringify({ baseline: ledger.sha, callbacks, anchors, successors }, null, 2) + '\n',
);

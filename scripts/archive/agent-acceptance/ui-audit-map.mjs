// Print the instrumentation ceiling separately from executed assertions.
// Usage: node scripts/archive/agent-acceptance/ui-audit-map.mjs [report.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindings, matchBindings } from "../../../apps/web/tests/ui-audit-bindings.ts";
const root = fileURLToPath(new URL("../../../", import.meta.url)),
  index = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/tests/p0-ui-index.json'), 'utf8'));
const ids = Object.values(index.callbacks).flat(),
  files = new Set(ids.map((id) => id.split(':')[1]));
const matched = new Set(),
  reasons = new Map();
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const source = bindings(file, fs.readFileSync(full, 'utf8'));
  for (const m of matchBindings(source, index)) matched.add(m.id);
  for (const site of source)
    for (const id of index.callbacks[site.key] ?? []) {
      if (!matched.has(id))
        reasons.set(id, site.eligible ? 'ambiguous source site' : 'listener identity not proven');
    }
}
const missing = ids
  .filter((id) => !matched.has(id))
  .map((id) => ({ id, reason: reasons.get(id) ?? 'source tokens changed or site removed' }));
const summary = {
  total: ids.length,
  instrumentable: matched.size,
  unmatched: missing.length,
  unmatchedReasons: Object.fromEntries(
    [...new Set(missing.map((s) => s.reason))].map((reason) => [
      reason,
      missing.filter((s) => s.reason === reason).length,
    ]),
  ),
};
if (process.argv[2])
  fs.writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        baseline: index.baseline,
        scope: 'static source identification only; not execution evidence',
        ...summary,
        matched: [...matched].sort(),
        missing,
      },
      null,
      2,
    ) + '\n',
  );
console.log(JSON.stringify(summary));

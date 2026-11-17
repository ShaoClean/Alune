// Only acceptance builds populate the counters. A scenario gets a receipt
// after its assertions return, never merely because a callback was mounted.
const fs = require('node:fs');
const path = require('node:path');
async function counts(contents) {
  return new Map(
    await contents.executeJavaScript(
      "Array.from(window.__aluneAudit?.counts ?? JSON.parse(sessionStorage.getItem('alune.audit.counts')||'[]'))",
    ),
  );
}
async function measure(contents, ui, scenario, run) {
  const before = await counts(contents);
  await run();
  const after = await counts(contents),
    executed = [...after]
      .filter(([id, count]) => count > (before.get(id) ?? 0))
      .map(([id]) => id)
      .sort();
  if (process.env.ALUNE_CANDIDATE_EVIDENCE) {
    fs.mkdirSync(process.env.ALUNE_CANDIDATE_EVIDENCE, { recursive: true });
    const file = path.join(
      process.env.ALUNE_CANDIDATE_EVIDENCE,
      'scenarios-' + process.env.ALUNE_SMOKE_PHASE + '.jsonl',
    );
    fs.appendFileSync(
      file,
      JSON.stringify({
        sha: process.env.ALUNE_ACCEPTANCE_SHA ?? process.env.GITHUB_SHA ?? null,
        proof: process.env.GITHUB_RUN_ID
          ? 'https://github.com/' +
            process.env.GITHUB_REPOSITORY +
            '/actions/runs/' +
            process.env.GITHUB_RUN_ID
          : null,
        platform: process.platform,
        arch: process.arch,
        ui,
        scenario,
        executed,
      }) + '\n',
    );
  }
}
module.exports = { counts, measure };

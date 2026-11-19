// Record scenarios after their assertions have passed.
const fs = require('node:fs');
const path = require('node:path');
async function measure(ui, scenario, run) {
  await run();
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
      }) + '\n',
    );
  }
}
module.exports = { measure };

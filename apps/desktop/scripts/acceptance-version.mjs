// Only the throwaway installer in the hosted update drill changes version.
// The immutable stable release can then be found through the real update feed.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted')
  throw Error('Hosted runner required');
const tag = execFileSync(
  'gh',
  ['release', 'view', '--repo', 'ShaoClean/Alune', '--json', 'tagName', '--jq', '.tagName'],
  { encoding: 'utf8' },
).trim();
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw Error('Expected a stable public release');
const stable = tag.slice(1);
fs.appendFileSync(process.env.GITHUB_ENV, 'ALUNE_VALIDATION_STABLE=' + stable + '\n');
for (const file of ['package.json', 'package-lock.json']) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = stable + '-rc.1';
  if (pkg.packages) pkg.packages[''].version = pkg.version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

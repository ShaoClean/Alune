// Only the throwaway installer in the hosted update drill changes version.
// The immutable stable release can then be found through the real update feed.
import fs from 'node:fs';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted')
  throw Error('Hosted runner required');
for (const file of ['package.json', 'package-lock.json']) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = '0.11.0-rc.1';
  if (pkg.packages) pkg.packages[''].version = pkg.version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

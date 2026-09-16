import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const source = await readFile(new URL('apps/desktop/assets/icon.svg', root), 'utf8');
const compactViewBox = source.match(/ data-compact-view-box="([^"]+)"/)?.[1];
if (!compactViewBox) throw new Error('icon.svg must declare data-compact-view-box for the web icon.');

// Preserve the exact artwork. Only the desktop padding and shadow are removed
// for favicons and in-app marks, where every pixel counts.
const compact = source
  .replace(/ data-compact-view-box="[^"]+"/, '')
  .replace('width="1024" height="1024"', 'width="64" height="64"')
  .replace(/ viewBox="[^"]+"/, ` viewBox="${compactViewBox}"`)
  .replace(/    <filter id="icon-shadow"[\s\S]*?<\/filter>\n/, '')
  .replace(' filter="url(#icon-shadow)"', '');
const generated = '<!-- Generated from apps/desktop/assets/icon.svg by npm run icons:generate. -->\n';
const outputs = [
  ['apps/desktop/assets/icon.png', new Resvg(source).render().asPng()],
  ['apps/web/public/favicon.svg', Buffer.from(generated + compact)],
];

for (const [name, contents] of outputs) {
  const file = new URL(name, root);
  if (check) {
    const existing = await readFile(file).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!existing?.equals(contents)) {
      console.error(`${name} is out of date. Run npm run icons:generate.`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(file, contents);
    console.log(`Generated ${name}`);
  }
}
if (check && !process.exitCode) console.log('Desktop and web icons match the SVG source.');

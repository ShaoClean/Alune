import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const source = await readFile(new URL('apps/desktop/assets/alune.png', root));
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!source.subarray(0, 8).equals(signature) || source.toString('ascii', 12, 16) !== 'IHDR') {
  throw new Error('apps/desktop/assets/alune.png must be a PNG image.');
}
const width = source.readUInt32BE(16);
const height = source.readUInt32BE(20);
if (width !== height || width < 1024) {
  throw new Error('apps/desktop/assets/alune.png must be square and at least 1024 pixels wide.');
}

// Keep the original illustration as the source of truth. Resvg scales its
// pixels and alpha consistently for the desktop icon and the web brand mark.
const artwork = source.toString('base64');
function render(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" xlink:href="data:image/png;base64,${artwork}"/></svg>`;
  return new Resvg(svg).render().asPng();
}
const outputs = [
  ['apps/desktop/assets/icon.png', render(1024)],
  // Vite content-hashes this imported image, avoiding stale Electron favicons.
  ['apps/web/src/assets/favicon.png', render(64)],
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
if (check && !process.exitCode) console.log('Desktop and web icons match the Alune PNG source.');

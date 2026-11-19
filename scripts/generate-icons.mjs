import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const master = await readFile(new URL('apps/desktop/assets/moon-creature.svg', root), 'utf8');

// Reference a named group from the editable master. Only the macOS tile
// receives platform padding, once, around the full-bleed drawing.
function render(group, size, inset = 0) {
  const extent = size - 2 * inset;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}">
    <defs>${master}</defs><svg x="${inset}" y="${inset}" width="${extent}" height="${extent}" viewBox="0 0 256 256"><use xlink:href="#${group}"/></svg></svg>`;
  return new Resvg(svg).render().asPng();
}

const avatar = render('avatar', 64);
// Keep the vector lettering independent of fonts installed on the build host.
const lockup = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="304" height="96" viewBox="0 0 152 48">
  <title>Alune</title>
  <style>.letters{stroke:#3c283a}@media(prefers-color-scheme:dark){.letters{stroke:#fff2e6}}</style>
  <image x="1" y="1" width="46" height="46" xlink:href="data:image/png;base64,${avatar.toString('base64')}"/>
  <g class="letters" fill="none" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M58 35l9-24 9 24m-15-7h12M83 11v24M92 20v9q0 7 6 6q5-1 6-6m0-9v15M113 35V20m0 7q1-8 7-7q5 0 5 7v8M147 32q-3 5-9 3q-6-2-5-9q1-7 7-6q7 0 7 8h-14"/>
  </g>
</svg>
`);
const outputs = [
  ['apps/website/public/alune-lockup.svg', lockup],
  ['apps/desktop/assets/icon.png', render('app', 1024)],
  ['apps/desktop/assets/icon-mac.png', render('app', 1024, 100)],
  ['apps/desktop/assets/trayTemplate.png', render('template', 22)],
  ['apps/desktop/assets/trayTemplate@2x.png', render('template', 44)],
  ['apps/desktop/assets/tray.png', render('avatar', 32)],
  ['apps/web/src/assets/favicon.png', avatar],
  ['apps/website/public/favicon.png', avatar],
  ['apps/website/public/brand.png', render('character', 144)],
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
if (check && !process.exitCode) console.log('Generated icons match the Alune SVG master.');

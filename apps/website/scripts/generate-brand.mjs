import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const source = new URL('../../desktop/assets/alune.png', import.meta.url);
const output = new URL('../public/', import.meta.url);
await sharp(await readFile(source))
  .resize(64, 64)
  .png()
  .toFile(fileURLToPath(new URL('favicon.png', output)));
await sharp(await readFile(source))
  .resize(144, 144)
  .png()
  .toFile(fileURLToPath(new URL('brand.png', output)));
const screenshot = await sharp(
  await readFile(new URL('../src/assets/screenshots/workspace-light.png', import.meta.url)),
)
  .resize(980)
  .png()
  .toBuffer();
const portrait = await sharp(await readFile(source))
  .resize(60, 60)
  .png()
  .toBuffer();
const typography = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="moon"><stop stop-color="#6e86e8"/><stop offset="1" stop-color="#8fe3ee"/></linearGradient></defs>
<rect width="1200" height="630" fill="#edf1f9"/><rect width="1200" height="8" fill="url(#moon)"/>
<text x="142" y="93" font-family="Arial,sans-serif" font-size="44" font-weight="600" fill="#111c36">Alune</text>
<text x="70" y="177" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="43" font-weight="500" fill="#111c36">本地与 SSH 远程 Git 工作区</text>
<text x="70" y="220" font-family="Arial,sans-serif" font-size="19" fill="#56648a">macOS / Windows / Linux</text>
<rect x="102" y="264" width="996" height="510" rx="22" fill="#fbfcff" stroke="#d8e0ee"/>
</svg>`);
await sharp(typography)
  .composite([
    { input: portrait, left: 70, top: 44 },
    { input: screenshot, left: 110, top: 272 },
  ])
  .png()
  .toFile(fileURLToPath(new URL('og-image.png', output)));

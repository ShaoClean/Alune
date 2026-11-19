import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const output = new URL('../public/', import.meta.url);
const screenshot = await sharp(
  await readFile(new URL('../src/assets/screenshots/workspace-light.png', import.meta.url)),
)
  .resize(980)
  .png()
  .toBuffer();
const lockup = await sharp(await readFile(new URL('alune-lockup.svg', output)))
  .resize({ height: 64 })
  .png()
  .toBuffer();
const typography = Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="moon"><stop stop-color="#ae79e6"/><stop offset="1" stop-color="#ffad78"/></linearGradient></defs>
<rect width="1200" height="630" fill="#faf4f8"/><rect width="1200" height="8" fill="url(#moon)"/>
<text x="70" y="177" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="43" font-weight="500" fill="#392538">本地与 SSH 远程 Git 工作区</text>
<text x="70" y="220" font-family="Arial,sans-serif" font-size="19" fill="#685369">macOS / Windows / Linux</text>
<rect x="102" y="264" width="996" height="510" rx="22" fill="#fbfcff" stroke="#d8e0ee"/>
</svg>`);
await sharp(typography)
  .composite([
    { input: lockup, left: 70, top: 44 },
    { input: screenshot, left: 110, top: 272 },
  ])
  .png()
  .toFile(fileURLToPath(new URL('og-image.png', output)));

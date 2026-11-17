const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error('Invalid root application version');
fs.mkdirSync(path.join(__dirname, '../dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../dist/version.json'), JSON.stringify({ version }) + '\n');

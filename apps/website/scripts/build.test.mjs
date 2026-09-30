import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const origin = 'https://shaoclean.github.io';
const base = '/Alune/';
const attributes = (name) =>
  [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((match) =>
    match[1].replaceAll('&amp;', '&'),
  );

test('GitHub project Pages resolves every local asset and internal link', async () => {
  const ids = attributes('id');
  assert.equal(
    new Set(ids).size,
    ids.length,
    'duplicate IDs break anchor and accessible-control targets',
  );
  const references = [
    ...attributes('src'),
    ...attributes('href'),
    ...attributes('srcset').flatMap((value) =>
      value.split(',').map((entry) => entry.trim().split(/\s+/)[0]),
    ),
  ];
  assert.ok(
    references.some((ref) => ref.includes('.webp')),
    'build must emit optimized screenshots',
  );
  for (const ref of references) {
    const url = new URL(ref, `${origin}${base}`);
    if (url.origin !== origin) continue;
    assert.ok(url.pathname.startsWith(base), `path escaped the project base: ${ref}`);
    if (url.hash)
      assert.ok(ids.includes(decodeURIComponent(url.hash.slice(1))), `missing anchor: ${ref}`);
    const path = url.pathname.slice(base.length);
    await access(new URL(path || 'index.html', dist)).catch(() =>
      assert.fail(`missing build output: ${ref} in ${fileURLToPath(dist)}`),
    );
  }
  for (const target of attributes('aria-controls'))
    assert.ok(ids.includes(target), `missing controlled element: ${target}`);
});

test('sharing metadata and platform downloads use permanent public URLs', () => {
  assert.ok(html.includes(`rel="canonical" href="${origin}${base}"`));
  assert.ok(html.includes(`${origin}${base}og-image.png`));
  const downloadLinks = attributes('href').filter(
    (href) => href === 'https://github.com/ShaoClean/Alune/releases/latest',
  );
  assert.equal(downloadLinks.length, 4, 'each platform must link to the latest stable release');
  assert.ok(
    !attributes('href').some((href) => /releases\/download\/v/.test(href)),
    'avoid stale hardcoded version downloads',
  );
  assert.ok(
    !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html),
    'fonts should be self-hosted',
  );
});

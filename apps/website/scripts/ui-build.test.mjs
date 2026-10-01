import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
const dist = new URL('../dist/', import.meta.url);
const origin = 'https://shaoclean.github.io';
const base = '/Alune/';
async function walk(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) output.push(...(await walk(file)));
    else output.push(file);
  }
  return output;
}
const all = await walk(dist);
const pages = new Map();
for (const file of all.filter((file) => file.pathname.endsWith('.html'))) {
  const relative = file.pathname.slice(dist.pathname.length);
  const path = base + relative.replace(/index\.html$/, '');
  const html = await readFile(file, 'utf8');
  const attrs = (name) =>
    [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((match) =>
      match[1].replaceAll('&amp;', '&'),
    );
  pages.set(path, { html, attrs, ids: attrs('id') });
}
function targetPath(url) {
  return url.pathname.endsWith('/')
    ? url.pathname
    : url.pathname.endsWith('.html')
      ? url.pathname
      : url.pathname + '/';
}
async function exists(url) {
  const relative = url.pathname.slice(base.length);
  let file = new URL(relative, dist);
  if (url.pathname.endsWith('/')) file = new URL('index.html', file);
  await access(file).catch(() => assert.fail(`missing build output: ${url.href}`));
}
test('all static documents and previews preserve base, resources, anchors, ids, controls and canonical', async () => {
  assert.ok(pages.size >= 78, `expected product, documents and previews, got ${pages.size}`);
  for (const [path, { html, attrs, ids }] of pages) {
    assert.equal(ids.length, new Set(ids).size, `duplicate id in ${path}`);
    const canonical = [...html.matchAll(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(canonical, [origin + path], `canonical for ${path}`);
    for (const control of attrs('aria-controls'))
      for (const id of control.split(/\s+/))
        assert.ok(ids.includes(id), `missing aria-controls ${id} in ${path}`);
    const refs = [
      ...attrs('src'),
      ...attrs('href'),
      ...attrs('srcset')
        .filter((value) => !value.startsWith('data:'))
        .flatMap((value) => value.split(',').map((entry) => entry.trim().split(/\s+/)[0])),
    ];
    for (const ref of refs) {
      const url = new URL(ref, origin + path);
      if (url.origin !== origin) continue;
      assert.ok(url.pathname.startsWith(base), `${ref} escaped base in ${path}`);
      await exists(url);
      if (url.hash) {
        const page = pages.get(targetPath(url));
        assert.ok(
          page?.ids.includes(decodeURIComponent(url.hash.slice(1))),
          `missing cross-page anchor ${ref} in ${path}`,
        );
      }
    }
  }
  for (const file of all.filter((file) => file.pathname.endsWith('.css'))) {
    const css = await readFile(file, 'utf8');
    const path = base + file.pathname.slice(dist.pathname.length);
    for (const match of css.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) {
      const url = new URL(match[1], origin + path);
      if (url.origin === origin) {
        assert.ok(url.pathname.startsWith(base), `CSS resource escaped base: ${url.href}`);
        await exists(url);
      }
    }
  }
});
test('documents remain readable without JavaScript and product home excludes demo runtime', () => {
  const home = pages.get(base).html;
  assert.ok(
    !home.includes('<iframe') && !home.includes('<astro-island'),
    'product home loaded UI runtime',
  );
  assert.ok(home.includes(`${base}ui/`), 'missing public UI navigation');
  for (const [path, { html }] of pages) {
    if (!path.startsWith(base + 'ui/') || path.includes('/preview/')) continue;
    assert.match(html, /<h1[\s>]/, path);
    assert.match(html, /<main[^>]+id="main"/, path);
    if (html.includes('<iframe')) {
      assert.match(html, /<details[^>]+open/, `source is not readable without JS in ${path}`);
      assert.match(html, /<pre[\s>]/, path);
      assert.match(html, /<iframe[^>]+title="[^"]+"[^>]+loading="lazy"/, path);
    }
  }
});

test('every rendered demo exposes the exact executable TSX source for copying', async () => {
  const seen = new Set();
  const decode = (html) =>
    html.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
      if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity];
    });
  for (const [path, { html }] of pages) {
    for (const match of html.matchAll(
      /<section[^>]+data-demo="([^"]+)"[\s\S]*?<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/g,
    )) {
      const [, id, highlighted] = match;
      const actual = decode(highlighted.replace(/<[^>]*>/g, ''));
      const source = await readFile(new URL(`../src/examples/${id}.tsx`, import.meta.url), 'utf8');
      assert.equal(actual, source, `${path}: ${id} copied source differs from executable source`);
      seen.add(id);
    }
  }
  const examples = (await readdir(new URL('../src/examples/', import.meta.url))).filter(
    (name) => name.endsWith('.tsx') && name !== 'DemoRoot.tsx',
  );
  assert.equal(seen.size, examples.length, 'every example must have a rendered source');
});

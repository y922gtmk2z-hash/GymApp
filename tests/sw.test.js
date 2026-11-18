import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('service worker precache list matches the app shell on disk', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const list = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const onDisk = [
    './index.html', './styles.css', './manifest.webmanifest',
    ...walk(join(root, 'js')).map((p) => './' + relative(root, p).split('\\').join('/')),
    ...walk(join(root, 'icons')).map((p) => './' + relative(root, p).split('\\').join('/')),
  ];
  const listed = new Set(list.filter((x) => x !== './'));
  for (const f of onDisk) assert.ok(listed.has(f), `sw.js SHELL is missing ${f}`);
  for (const f of listed) assert.ok(onDisk.includes(f), `sw.js SHELL lists ${f} which does not exist`);
  assert.ok(list.includes('./'), 'SHELL should include ./');
  assert.match(sw, /const VERSION = \d+;/);
});

test('index.html uses only relative URLs', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const urls = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const u of urls) assert.ok(!u.startsWith('/') || u.startsWith('#'), `absolute URL in index.html: ${u}`);
});

test('manifest is valid and relative', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512'));
});

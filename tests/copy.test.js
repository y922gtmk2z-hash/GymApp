import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test('R2 ACCEPTANCE: no screen asks for or shows calories', () => {
  const files = [join(root, 'index.html'), join(root, 'manifest.webmanifest'), ...walk(join(root, 'js'))];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /calor|kcal|\bcal\b/i, `${f} mentions calories`);
  }
});

test('no network calls or third-party URLs in app code', () => {
  for (const f of walk(join(root, 'js'))) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|https?:\/\//, `${f} looks like it reaches the network`);
  }
});

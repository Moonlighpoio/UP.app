import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function jsFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

function exportsOf(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declared = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${escaped}(?![\\w$])`
  ).test(source);
  if (declared) return true;
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    const names = block[1].split(',').map((entry) =>
      entry
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim()
    );
    if (names.includes(name)) return true;
  }
  return false;
}

test('los imports nombrados entre módulos propios apuntan a exports reales', () => {
  const sources = new Map();
  for (const file of jsFiles(resolve(ROOT, 'src'))) {
    sources.set(file, readFileSync(file, 'utf8'));
  }

  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g;
  for (const [file, source] of sources) {
    for (const match of source.matchAll(importPattern)) {
      const names = match[1]
        .split(',')
        .map((entry) =>
          entry
            .trim()
            .split(/\s+as\s+/)[0]
            .trim()
        )
        .filter(Boolean);
      const target = resolve(dirname(file), match[2]);
      const targetSource = sources.get(target);
      assert.ok(targetSource, `${file}: no existe ${match[2]}`);
      for (const name of names) {
        assert.ok(exportsOf(targetSource, name), `${file}: ${match[2]} no exporta ${name}`);
      }
    }
  }
});

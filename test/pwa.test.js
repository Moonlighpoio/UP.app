import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const server = readFileSync(new URL('server.js', root), 'utf8');

test('el manifest es instalable, usa el tema y declara íconos del tamaño requerido', () => {
  assert.equal(manifest.lang, 'es-CL');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0B0B0C');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.ok(manifest.shortcuts.length >= 3);
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="assets\/icons\/icon-192\.png"/);
});

test('el service worker es local, excluye /api y tiene respaldo offline', () => {
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /url\.pathname\.includes\('\/api\/'\)/);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /cache\.match\('\.\/index\.html'\)/);
  assert.match(sw, /cache\.match\('\.\/offline\.html'\)/);
  assert.doesNotMatch(sw, /fetch\(['"]https?:\/\//);
});

test('el servidor sirve el manifest con MIME y la CSP lo permite', () => {
  assert.match(server, /'\.webmanifest': 'application\/manifest\+json/);
  assert.match(server, /manifest-src 'self'/);
});

test('la navegación inferior y el aviso offline están en el markup', () => {
  for (const key of ['home', 'search', 'ofertas', 'lista', 'cuenta']) {
    assert.match(html, new RegExp(`data-nav="${key}"`));
  }
  assert.match(html, /id="offline-banner"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="pwa-install-btn"/);
});

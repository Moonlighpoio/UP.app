#!/usr/bin/env node
/**
 * UP · Auditoría WCAG 2.1 de los tokens de color (sin dependencias).
 *
 * Uso: npm run check-contrast
 *
 * Lee los tokens reales desde :root en styles.css y verifica cada par
 * texto/fondo declarado. Falla con código 1 si algún par queda por debajo
 * de 4.5:1 (texto normal) o 3:1 (texto grande y componentes).
 *
 * `--border` se excluye: es un separador decorativo. Los bordes de control
 * usan `--text-muted`, que sí se audita como componente.
 */
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.join(__dirname, '..', 'styles.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const root = css.match(/:root\s*\{([\s\S]*?)\}/);

if (!root) {
  console.error('No se encontró el bloque :root en styles.css');
  process.exit(1);
}

const tokens = {};
const hexPattern = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
for (const match of root[1].matchAll(hexPattern)) {
  const raw = match[2].slice(1);
  if (raw.length !== 3 && raw.length !== 6) continue;
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((char) => char + char)
          .join('')
      : raw;
  tokens[match[1]] = full.toUpperCase();
}

const PAIRS = [
  { label: 'texto sobre fondo', fg: 'text', bg: 'bg', min: 4.5 },
  { label: 'texto sobre superficie', fg: 'text', bg: 'surface', min: 4.5 },
  { label: 'texto sobre superficie-2', fg: 'text', bg: 'surface-2', min: 4.5 },
  { label: 'muted sobre fondo', fg: 'text-muted', bg: 'bg', min: 4.5 },
  { label: 'muted sobre superficie', fg: 'text-muted', bg: 'surface', min: 4.5 },
  { label: 'muted sobre superficie-2 (disabled)', fg: 'text-muted', bg: 'surface-2', min: 4.5 },
  { label: 'texto sobre amarillo', fg: 'text', bg: 'brand-yellow', min: 4.5 },
  { label: 'negro sobre amarillo (CTA)', fg: 'brand-black', bg: 'brand-yellow', min: 4.5 },
  { label: 'blanco sobre negro (superficie oscura)', fg: 'on-dark', bg: 'brand-black', min: 4.5 },
  { label: 'muted oscuro sobre negro', fg: 'on-dark-muted', bg: 'brand-black', min: 4.5 },
  { label: 'success-text sobre success-bg', fg: 'success-text', bg: 'success-bg', min: 4.5 },
  { label: 'success-text sobre superficie', fg: 'success-text', bg: 'surface', min: 4.5 },
  { label: 'danger sobre danger-bg', fg: 'danger', bg: 'danger-bg', min: 4.5 },
  { label: 'danger sobre superficie', fg: 'danger', bg: 'surface', min: 4.5 },
  { label: 'warning sobre warning-bg', fg: 'warning', bg: 'warning-bg', min: 4.5 },
  { label: 'warning sobre superficie', fg: 'warning', bg: 'surface', min: 4.5 },
  { label: 'focus sobre superficie', fg: 'focus', bg: 'surface', min: 4.5 },
  { label: 'componente: negro sobre superficie', fg: 'brand-black', bg: 'surface', min: 3 },
  { label: 'componente: blanco sobre negro', fg: 'on-dark', bg: 'brand-black', min: 3 },
  { label: 'componente: success sobre success-bg', fg: 'success', bg: 'success-bg', min: 3 },
  { label: 'componente: danger sobre danger-bg', fg: 'danger', bg: 'danger-bg', min: 3 },
  { label: 'componente: warning sobre warning-bg', fg: 'warning', bg: 'warning-bg', min: 3 },
  { label: 'componente: borde de control', fg: 'text-muted', bg: 'surface', min: 3 },
  {
    label: 'componente: anillo foco sobre CTA amarillo',
    fg: 'brand-black',
    bg: 'brand-yellow',
    min: 3,
  },
  { label: 'componente: anillo foco sobre superficie', fg: 'brand-black', bg: 'surface', min: 3 },
];

function channels(hex) {
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex) {
  const linear = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const rows = [];
for (const pair of PAIRS) {
  const fg = tokens[pair.fg];
  const bg = tokens[pair.bg];
  if (!fg || !bg) {
    rows.push({
      ...pair,
      ratio: 0,
      ok: false,
      detail: `token ausente: ${!fg ? pair.fg : pair.bg}`,
    });
    continue;
  }
  const ratio = contrast(fg, bg);
  rows.push({
    ...pair,
    ratio,
    ok: ratio >= pair.min,
    detail: `#${fg} / #${bg}`,
  });
}

console.log('UP · Auditoría de contraste WCAG 2.1');
console.log(`Fuente: ${path.relative(process.cwd(), CSS_PATH)} (:root) · ${PAIRS.length} pares\n`);
console.log(
  'PAR'.padEnd(44) + 'TEXTO / FONDO'.padEnd(19) + 'RATIO'.padEnd(8) + 'MÍN'.padEnd(6) + 'ESTADO'
);
for (const row of rows) {
  console.log(
    row.label.padEnd(44) +
      row.detail.padEnd(19) +
      row.ratio.toFixed(2).padEnd(8) +
      String(row.min).padEnd(6) +
      (row.ok ? 'OK' : 'FALLA')
  );
}

const failures = rows.filter((row) => !row.ok);
console.log(
  `\nResumen: ${rows.length - failures.length}/${rows.length} pares OK · ${failures.length} fallos.`
);
console.log('Nota: --border es decorativo; los bordes de control usan --text-muted.');

if (failures.length) {
  console.error('\nContraste insuficiente:');
  for (const row of failures) {
    console.error(`  - ${row.label}: ${row.ratio.toFixed(2)}:1 < ${row.min}:1 (${row.detail})`);
  }
  process.exit(1);
}

#!/usr/bin/env node
/**
 * UP · Auditoría WCAG 2.1 del sistema visual negro / blanco / dorado.
 *
 * Uso: npm run check-contrast
 *
 * Sin dependencias. Lee los tokens reales desde :root en styles.css y calcula
 * el contraste de cada par texto/fondo declarado. Las capas semitransparentes
 * (--gold-soft, --border-gold, etc.) se componen sobre su superficie antes de
 * medir. Sale con código 1 si un par baja de 4.5:1 (texto normal) o de 3:1
 * (texto grande y componentes interactivos).
 *
 * Los bordes puramente decorativos (--border, --border-gold) no se auditan como
 * componentes: el borde de los controles usa --text-muted, que sí se mide.
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

/** tokens[name] = { r, g, b, a } con valores 0-255 y alfa 0-1. */
const tokens = {};
for (const match of root[1].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*;/g)) {
  const raw = match[2].trim();
  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (full.length !== 6) continue;
    tokens[match[1]] = {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: 1,
    };
    continue;
  }
  const nums = raw.match(/-?\d*\.?\d+/g);
  if (!nums || nums.length < 3) continue;
  tokens[match[1]] = {
    r: Number(nums[0]),
    g: Number(nums[1]),
    b: Number(nums[2]),
    a: nums[3] === undefined ? 1 : Number(nums[3]),
  };
}

function composite(fg, bg) {
  if (fg.a >= 1) return { ...fg, a: 1 };
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance(color) {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hex(color) {
  return (
    '#' +
    [color.r, color.g, color.b]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/**
 * `over` compone una capa semitransparente antes de medir. `min` es 4.5 para
 * texto normal y 3 para texto grande / límites de componentes.
 */
const PAIRS = [
  { label: 'texto principal sobre fondo', fg: 'text', bg: 'bg', min: 4.5 },
  { label: 'texto principal sobre superficie', fg: 'text', bg: 'surface', min: 4.5 },
  { label: 'texto principal sobre superficie-2', fg: 'text', bg: 'surface-2', min: 4.5 },
  { label: 'texto principal sobre superficie-3', fg: 'text', bg: 'surface-3', min: 4.5 },
  { label: 'texto secundario sobre fondo', fg: 'text-muted', bg: 'bg', min: 4.5 },
  { label: 'texto secundario sobre superficie', fg: 'text-muted', bg: 'surface', min: 4.5 },
  { label: 'texto secundario sobre superficie-2', fg: 'text-muted', bg: 'surface-2', min: 4.5 },
  { label: 'texto secundario sobre superficie-3', fg: 'text-muted', bg: 'surface-3', min: 4.5 },
  { label: 'texto sobre dorado (CTA y cinta)', fg: 'on-gold', bg: 'gold', min: 4.5 },
  { label: 'texto sobre dorado en hover', fg: 'on-gold', bg: 'gold-hover', min: 4.5 },
  { label: 'texto sobre blanco (banda de contraste)', fg: 'on-white', bg: 'white', min: 4.5 },
  {
    label: 'texto técnico sobre blanco (panel de foto)',
    fg: 'on-white-muted',
    bg: 'white',
    min: 4.5,
  },
  { label: 'dorado como texto sobre fondo', fg: 'gold', bg: 'bg', min: 4.5 },
  { label: 'dorado como texto sobre superficie', fg: 'gold', bg: 'surface', min: 4.5 },
  { label: 'dorado como texto sobre superficie-2', fg: 'gold', bg: 'surface-2', min: 4.5 },
  { label: 'dorado activo como texto sobre superficie', fg: 'gold-deep', bg: 'surface', min: 4.5 },
  { label: 'éxito sobre superficie', fg: 'success', bg: 'surface', min: 4.5 },
  { label: 'peligro sobre superficie', fg: 'danger', bg: 'surface', min: 4.5 },
  { label: 'advertencia sobre superficie', fg: 'warning', bg: 'surface', min: 4.5 },
  {
    label: 'texto sobre gold-soft (chips activos)',
    fg: 'text',
    bg: 'gold-soft',
    over: 'surface',
    min: 4.5,
  },
  {
    label: 'dorado sobre gold-soft (mejor precio)',
    fg: 'gold',
    bg: 'gold-soft',
    over: 'surface',
    min: 4.5,
  },
  {
    label: 'texto sobre gold-soft en superficie-2',
    fg: 'text',
    bg: 'gold-soft',
    over: 'surface-2',
    min: 4.5,
  },
  {
    label: 'dorado sobre gold-soft en superficie-2',
    fg: 'gold',
    bg: 'gold-soft',
    over: 'surface-2',
    min: 4.5,
  },
  {
    label: 'componente: borde dorado de mejor precio',
    fg: 'gold',
    bg: 'surface-2',
    min: 3,
  },
  {
    label: 'texto secundario sobre danger-soft',
    fg: 'text',
    bg: 'danger-soft',
    over: 'surface',
    min: 4.5,
  },
  {
    label: 'texto sobre success-soft',
    fg: 'text',
    bg: 'success-soft',
    over: 'surface',
    min: 4.5,
  },
  {
    label: 'éxito sobre success-soft',
    fg: 'success',
    bg: 'success-soft',
    over: 'surface',
    min: 4.5,
  },
  {
    label: 'peligro sobre danger-soft',
    fg: 'danger',
    bg: 'danger-soft',
    over: 'surface',
    min: 4.5,
  },
  {
    label: 'advertencia sobre warning-soft',
    fg: 'warning',
    bg: 'warning-soft',
    over: 'surface',
    min: 4.5,
  },
  { label: 'componente: anillo de foco', fg: 'focus', bg: 'surface', min: 3 },
  { label: 'componente: foco sobre fondo', fg: 'focus', bg: 'bg', min: 3 },
  { label: 'componente: borde de control', fg: 'text-muted', bg: 'surface', min: 3 },
  { label: 'componente: CTA dorado', fg: 'gold', bg: 'bg', min: 3 },
  { label: 'componente: éxito', fg: 'success', bg: 'surface', min: 3 },
  { label: 'componente: peligro', fg: 'danger', bg: 'surface', min: 3 },
  { label: 'componente: advertencia', fg: 'warning', bg: 'surface', min: 3 },
];

const rows = PAIRS.map((pair) => {
  const fg = tokens[pair.fg];
  const base = tokens[pair.bg];
  if (!fg || !base) {
    return {
      ...pair,
      ratio: 0,
      ok: false,
      detail: `token ausente: ${!fg ? pair.fg : pair.bg}`,
    };
  }
  const background = pair.over ? composite(base, tokens[pair.over]) : base;
  const foreground = composite(fg, background);
  const ratio = contrast(foreground, background);
  return {
    ...pair,
    ratio,
    ok: ratio >= pair.min,
    detail: `${hex(foreground)} / ${hex(background)}`,
  };
});

console.log('UP · Auditoría de contraste WCAG 2.1');
console.log(`Fuente: ${path.relative(process.cwd(), CSS_PATH)} (:root) · ${PAIRS.length} pares\n`);
console.log(
  'PAR'.padEnd(46) + 'TEXTO / FONDO'.padEnd(19) + 'RATIO'.padEnd(8) + 'MÍN'.padEnd(6) + 'ESTADO'
);
for (const row of rows) {
  console.log(
    row.label.padEnd(46) +
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
console.log(
  'Nota: --gold-deep sobre blanco tiene 2.92:1; en la banda blanca se usa solo en adornos, nunca como texto.'
);

if (failures.length) {
  console.error('\nContraste insuficiente:');
  for (const row of failures) {
    console.error(`  - ${row.label}: ${row.ratio.toFixed(2)}:1 < ${row.min}:1 (${row.detail})`);
  }
  process.exit(1);
}

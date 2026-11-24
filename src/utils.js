/**
 * UP · Utilidades puras de UI (sin estado).
 */

export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

// Saneamiento de URLs antes de inyectarlas en href/src: solo http(s) válidos.
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

// Imágenes: solo rutas relativas bajo assets/ o una URL http(s) validada.
export function safeAssetUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  if (/^assets\/[A-Za-z0-9._/-]+$/.test(value) && !value.includes('..')) return value;
  return safeHttpUrl(value);
}

// La única implementación de formato CLP vive en money.js (pura y testeable).
export { formatCLP } from './money.js';

export const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function getProductSVG(iconType) {
  const svgs = {
    bottle: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="26" y="8" width="12" height="6" rx="1" stroke="#ffc700"/>
      <path d="M27 14L22 24V52C22 54.2 23.8 56 26 56H38C40.2 56 42 54.2 42 52V24L37 14" stroke="#ffffff"/>
      <rect x="22" y="30" width="20" height="12" stroke="#ffc700" stroke-dasharray="2 2"/>
      <line x1="27" y1="36" x2="37" y2="36" stroke="#9b9d9d"/>
    </svg>`,
    bag: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M18 16H46L49 52C49 54 47.5 56 45.5 56H18.5C16.5 56 15 54 15 52L18 16Z" stroke="#ffffff"/>
      <path d="M22 16L25 10H39L42 16" stroke="#ffc700"/>
      <rect x="23" y="28" width="18" height="14" rx="2" stroke="#ffc700" stroke-dasharray="2 2"/>
      <circle cx="32" cy="35" r="2" fill="#ffc700"/>
    </svg>`,
    oil: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="27" y="8" width="10" height="5" rx="1" stroke="#ffc700"/>
      <path d="M28 13L21 25V53C21 54.7 22.3 56 24 56H40C41.7 56 43 54.7 43 53V25L36 13" stroke="#ffffff"/>
      <path d="M32 30C32 30 27 36 27 39.5C27 42.3 29.2 44.5 32 44.5C34.8 44.5 37 42.3 37 39.5C37 36 32 30 32 30Z" stroke="#ffc700"/>
    </svg>`,
    milk: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M20 22L26 12H38L44 22V54H20V22Z" stroke="#ffffff"/>
      <line x1="20" y1="22" x2="44" y2="22" stroke="#595a5a"/>
      <rect x="25" y="30" width="14" height="12" stroke="#ffc700" stroke-dasharray="2 2"/>
      <line x1="28" y1="12" x2="36" y2="12" stroke="#ffc700" stroke-width="2.5"/>
    </svg>`,
    jar: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="22" y="12" width="20" height="6" rx="1" stroke="#ffc700"/>
      <rect x="18" y="18" width="28" height="36" rx="4" stroke="#ffffff"/>
      <rect x="22" y="28" width="20" height="14" stroke="#ffc700" stroke-dasharray="2 2"/>
    </svg>`,
    pasta: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="20" y="12" width="24" height="42" rx="2" stroke="#ffffff"/>
      <line x1="26" y1="18" x2="26" y2="48" stroke="#ffc700" stroke-dasharray="3 2"/>
      <line x1="32" y1="18" x2="32" y2="48" stroke="#ffc700" stroke-dasharray="3 2"/>
      <line x1="38" y1="18" x2="38" y2="48" stroke="#ffc700" stroke-dasharray="3 2"/>
    </svg>`,
    roll: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <ellipse cx="32" cy="18" rx="14" ry="6" stroke="#ffc700"/>
      <ellipse cx="32" cy="18" rx="4" ry="2" stroke="#ffffff"/>
      <path d="M18 18V46C18 49.3 24.3 52 32 52C39.7 52 46 49.3 46 46V18" stroke="#ffffff"/>
      <line x1="32" y1="24" x2="32" y2="52" stroke="#595a5a" stroke-dasharray="2 3"/>
    </svg>`,
    detergent: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="26" y="10" width="12" height="6" rx="1" stroke="#ffc700"/>
      <path d="M22 16H42L46 24V52C46 54 44.5 55 42.5 55H21.5C19.5 55 18 54 18 52V24L22 16Z" stroke="#ffffff"/>
      <path d="M38 24H42V34H38" stroke="#ffc700"/>
      <circle cx="30" cy="38" r="5" stroke="#ffc700" stroke-dasharray="2 2"/>
    </svg>`,
    bread: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M16 26C16 19 22 15 32 15C42 15 48 19 48 26V50H16V26Z" stroke="#ffffff"/>
      <line x1="22" y1="32" x2="42" y2="32" stroke="#ffc700" stroke-dasharray="2 2"/>
      <line x1="22" y1="40" x2="42" y2="40" stroke="#595a5a"/>
    </svg>`,
    can: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <ellipse cx="32" cy="22" rx="16" ry="6" stroke="#ffc700"/>
      <path d="M16 22V44C16 47.3 23.2 50 32 50C40.8 50 48 47.3 48 44V22" stroke="#ffffff"/>
      <line x1="16" y1="34" x2="48" y2="34" stroke="#595a5a" stroke-dasharray="2 2"/>
    </svg>`,
    cheese: `<svg class="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="14" y="20" width="36" height="24" rx="3" stroke="#ffffff"/>
      <rect x="20" y="26" width="24" height="12" stroke="#ffc700" stroke-dasharray="2 2"/>
      <circle cx="32" cy="32" r="2" fill="#ffc700"/>
    </svg>`,
  };
  return svgs[iconType] || svgs.bag;
}

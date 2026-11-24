/**
 * UP · Configuración compartida del front-end.
 * Sin dependencias: solo constantes del sistema visual y de negocio.
 */

// deliveryHours es una estimación de demostración para el filtro de plazo;
// no sustituye los tiempos reales que publica cada supermercado.
export const STORES = {
  lider: {
    id: 'lider',
    name: 'Lider',
    short: 'LIDER',
    freeShippingThreshold: 50000,
    shippingCost: 3990,
    deliveryHours: 24,
  },
  jumbo: {
    id: 'jumbo',
    name: 'Jumbo',
    short: 'JUMBO',
    freeShippingThreshold: 50000,
    shippingCost: 4490,
    deliveryHours: 24,
  },
  santaisabel: {
    id: 'santaisabel',
    name: 'Santa Isabel',
    short: 'STA ISABEL',
    freeShippingThreshold: 35000,
    shippingCost: 3490,
    deliveryHours: 48,
  },
  tottus: {
    id: 'tottus',
    name: 'Tottus',
    short: 'TOTTUS',
    freeShippingThreshold: 50000,
    shippingCost: 3990,
    deliveryHours: 24,
  },
  unimarc: {
    id: 'unimarc',
    name: 'Unimarc',
    short: 'UNIMARC',
    freeShippingThreshold: 35000,
    shippingCost: 3290,
    deliveryHours: 48,
  },
};

export const UP_FEE_RATE = 0.01;

// En GitHub Pages (y al abrir el archivo directamente) no existen los endpoints /api/*.
// El guardia typeof permite que los módulos también se importen desde Node en los tests.
export const STATIC_DEMO =
  typeof location !== 'undefined' &&
  (location.protocol === 'file:' || /(^|\.)github\.io$/i.test(location.hostname));

export const CHAIN_IDS = Object.keys(STORES);

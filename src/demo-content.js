/**
 * UP · Contenido editorial de ejemplo (FASE C).
 * Ofertas, eventos y beneficios bancarios FICTICIOS. Ninguno es una oferta
 * comercial real: sourceUrl y verifiedAt son null y status es 'demo'.
 * Para publicar datos reales se requiere fuente verificable y fecha.
 */

const BASE = Object.freeze({
  isDemo: true,
  status: 'demo',
  source: 'UP · texto propio (demo)',
  sourceUrl: null,
  verifiedAt: null,
});

export const DEMO_PROMOS = Object.freeze([
  {
    ...BASE,
    id: 'promo-despensa',
    type: 'oferta',
    title: 'Descuento ilustrativo en despensa (ejemplo)',
    chain: 'Lider',
    period: '2026-11-25 al 2026-12-01',
    summary:
      'Porcentaje ficticio creado para mostrar cómo UP ordenaría una promoción. No constituye una oferta comercial ni un precio real.',
  },
  {
    ...BASE,
    id: 'promo-granos',
    type: 'oferta',
    title: 'Segundo producto de granos a mitad de precio (ejemplo)',
    chain: 'Tottus',
    period: '2026-11-28 al 2026-12-04',
    summary:
      'Regla promocional de demostración. No se aplica al carrito, al total ni al checkout simulado.',
  },
  {
    ...BASE,
    id: 'promo-lacteos',
    type: 'oferta',
    title: 'Combinación de lácteos (ejemplo)',
    chain: 'Jumbo',
    period: '2026-12-01 al 2026-12-07',
    summary:
      'Texto neutro de ejemplo: UP no afirma disponibilidad, stock ni precio por este contenido.',
  },
  {
    ...BASE,
    id: 'evento-semana-despensa',
    type: 'evento',
    title: 'Semana de la despensa (ejemplo)',
    chain: 'Varias cadenas',
    period: '2026-11-30 al 2026-12-06',
    summary:
      'Calendario ilustrativo de campañas. Las fechas son ficticias y no representan actividades comerciales reales.',
  },
  {
    ...BASE,
    id: 'evento-feria-productos',
    type: 'evento',
    title: 'Feria de productos de temporada (ejemplo)',
    chain: 'Varias cadenas',
    period: '2026-12-08 al 2026-12-14',
    summary:
      'Evento de demostración para probar filtros y tarjetas. No hay inscripción, entrega ni beneficio real asociado.',
  },
]);

export const DEMO_BANK_BENEFITS = Object.freeze([
  {
    ...BASE,
    id: 'benef-abasto',
    bank: 'Banco Ejemplo A',
    title: 'Devolución ilustrativa en compras de abasto (ejemplo)',
    summary:
      'Simulación educativa de un beneficio bancario. No es un producto financiero ofrecido por UP.',
    conditions:
      'Sin montos, plazos ni requisitos reales. No se solicita número de tarjeta, vencimiento ni CVV.',
  },
  {
    ...BASE,
    id: 'benef-supermercados',
    bank: 'Banco Ejemplo B',
    title: 'Descuento ilustrativo en supermercados (ejemplo)',
    summary:
      'Contenido de muestra para explicar cómo se mostraría un beneficio verificado en el futuro.',
    conditions: 'Aplica sólo a esta demostración. No es acumulable con otras promociones reales.',
  },
  {
    ...BASE,
    id: 'benef-billetera',
    bank: 'Banco Ejemplo C',
    title: 'Beneficio ilustrativo con billetera digital (ejemplo)',
    summary: 'Ejemplo de beneficio vinculado a un método de pago simulado dentro de UP.',
    conditions: 'El pago de UP es simulado: no se conecta a bancos ni procesa datos de pago.',
  },
]);

export function getBankBenefit(id) {
  return DEMO_BANK_BENEFITS.find((item) => item.id === id) || null;
}

export function bankBenefitIds() {
  return DEMO_BANK_BENEFITS.map((item) => item.id);
}

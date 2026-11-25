/**
 * UP · Preguntas frecuentes locales (FASE U6).
 * Texto propio de la demo: no promete precios, plazos ni atención real.
 */
import { norm } from './utils.js';

export const FAQ_ITEMS = Object.freeze([
  {
    id: 'faq-precios',
    category: 'Precios',
    question: '¿Los precios son reales?',
    answer:
      'No. Son referenciales y están etiquetados como «Ejemplo». Un precio sólo se llama Verificado cuando tiene fecha de captura vigente y procedencia declarada.',
  },
  {
    id: 'faq-mejor',
    category: 'Precios',
    question: '¿Cómo se elige el «mejor precio»?',
    answer:
      'Sólo compara ofertas verificadas y frescas. Las ofertas pendientes, desactualizadas o con enlace roto se muestran como referencia, nunca como mejor precio.',
  },
  {
    id: 'faq-split',
    category: 'Pago',
    question: '¿Qué significa el pago unificado?',
    answer:
      'Agrupas productos de varias cadenas en carritos separados y pagas una sola vez en la simulación. El 99% del subtotal se reparte entre las cadenas y UP retiene el 1%: ese fee no se agrega a tu cobro.',
  },
  {
    id: 'faq-tarjeta',
    category: 'Pago',
    question: '¿Piden datos de tarjeta?',
    answer:
      'Nunca. El pago es simulado, sin números de tarjeta, vencimiento ni CVV. Tampoco se envía correo ni se procesa un pago real.',
  },
  {
    id: 'faq-datos',
    category: 'Privacidad',
    question: '¿Dónde se guardan mis datos?',
    answer:
      'Lista, favoritos, direcciones, carritos y preferencias viven en el localStorage de este navegador. El botón «Borrar mis datos» los elimina. La analítica interna no guarda correos ni nombres.',
  },
  {
    id: 'faq-offline',
    category: 'Uso',
    question: '¿Funciona sin conexión?',
    answer:
      'Después de la primera carga se guarda la interfaz y el catálogo de ejemplo. Tu lista y favoritos siguen disponibles; las acciones que requieren el servidor se muestran como no disponibles hasta volver a conectarte.',
  },
  {
    id: 'faq-onboarding',
    category: 'Uso',
    question: '¿Puedo cambiar mis preferencias?',
    answer:
      'Sí. Entra a Mi cuenta y usa «Preferencias de inicio» para volver a abrir el asistente de comuna, cadenas y tipo de entrega.',
  },
  {
    id: 'faq-contacto',
    category: 'Contacto',
    question: '¿Cómo contacto al equipo?',
    answer:
      'En este prototipo el contacto es simulado: no se envía ningún mensaje. El correo que aparece es de ejemplo y no debe usarse para datos reales.',
  },
]);

/** Búsqueda simple por pregunta, respuesta o categoría, sin librerías. */
export function filterFaq(items = FAQ_ITEMS, query = '') {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return items.slice();
  return items.filter((item) => {
    const haystack = norm(`${item.category} ${item.question} ${item.answer}`);
    return terms.every((term) => haystack.includes(term));
  });
}

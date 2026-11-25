/** #/ayuda/datos · Cómo obtenemos los precios (FASE U1). */
import { esc } from '../utils.js';
import { STALE_DAYS } from '../config.js';
import { demoBadge } from './shared.js';

const SOURCES = [
  {
    name: 'Fichas oficiales de supermercado',
    detail:
      'Sólo se usan enlaces canónicos o búsquedas exactas por SKU, GTIN o PLU. Nunca buscamos por nombre de producto.',
    freq: 'Cuando la cadena publica un cambio y tras una reverificación.',
  },
  {
    name: 'Feeds autorizados',
    detail:
      'Si un proveedor autoriza un feed, se consume con su permiso. Un 403 o 429 pausa el conector; no se evita el bloqueo.',
    freq: 'Cada 15 minutos como máximo (TTL del feed).',
  },
  {
    name: 'Contenido de demostración',
    detail:
      'Los ejemplos de UP se marcan como “Ejemplo” y jamás se presentan como ofertas comerciales ni como precios verificados.',
    freq: 'Se actualizan sólo cuando se regenera el prototipo.',
  },
];

const LABELS = [
  {
    name: 'Verificado',
    text: `La oferta tiene identificador y fecha de captura comprobables. Si la captura tiene más de ${STALE_DAYS} días deja de considerarse vigente.`,
    tone: 'ok',
  },
  {
    name: 'Sin confirmar',
    text: 'Hay un precio de referencia, pero falta una fuente verificable. No entra en el “mejor precio”.',
    tone: 'neutral',
  },
  {
    name: 'Desactualizado',
    text: `La fecha de captura superó los ${STALE_DAYS} días o no existe. Se muestra con aviso y queda fuera del “mejor precio”.`,
    tone: 'warning',
  },
  {
    name: 'Ejemplo',
    text: 'Contenido ficticio creado por UP para demostrar la interfaz. No es una oferta real.',
    tone: 'neutral',
  },
];

export const dataHelpView = {
  element: 'view-dynamic',
  render(container) {
    container.innerHTML = `
      <section class="up-view-section up-container up-help-page">
        <nav class="up-breadcrumb" aria-label="Ruta de navegación">
          <a href="#/">Inicio</a><span aria-hidden="true">›</span><span aria-current="page">Cómo obtenemos los precios</span>
        </nav>
        <span class="up-eyebrow">CONFIANZA EN LOS DATOS</span>
        <h1 data-view-title tabindex="-1">Cómo obtenemos los precios</h1>
        <p class="up-lead">
          Los precios de UP son <strong>referenciales</strong>: no constituyen una oferta comercial y
          pueden diferir del valor final en la tienda. Verifica siempre el precio antes de comprar.
        </p>

        <div class="up-notice up-notice--gold" role="note">
          <strong>Modo prueba:</strong> este prototipo funciona sin servidor. Las acciones se guardan
          en este navegador y no envían datos personales a ningún lado.
        </div>

        <h2>Fuentes y frecuencia</h2>
        <div class="up-table-wrap">
          <table class="up-data-table">
            <caption>Origen declarado de la información y cada cuánto se revisa.</caption>
            <thead><tr><th scope="col">Fuente</th><th scope="col">Cómo se obtiene</th><th scope="col">Frecuencia</th></tr></thead>
            <tbody>
              ${SOURCES.map(
                (item) =>
                  `<tr><th scope="row">${esc(item.name)}</th><td>${esc(item.detail)}</td><td>${esc(item.freq)}</td></tr>`
              ).join('')}
            </tbody>
          </table>
        </div>

        <h2>Qué significan las etiquetas</h2>
        <ul class="up-help-labels">
          ${LABELS.map(
            (item) =>
              `<li><span class="up-fresh up-fresh--${item.tone}">${esc(item.name)}</span><span>${esc(item.text)}</span></li>`
          ).join('')}
        </ul>

        <h2>Cómo reportar un precio</h2>
        <p>
          En el detalle o en el comparador puedes usar <strong>Reportar precio incorrecto</strong>.
          Indica cadena, motivo y un comentario opcional. Guardamos el reporte en este navegador;
          en modo prueba no se contacta a la tienda ni se publica nada.
        </p>
        <p>${demoBadge(true)} Los ejemplos de este prototipo están etiquetados visiblemente.</p>
      </section>`;
  },
};

/**
 * UP · Diálogo de reporte de precio (FASE U1).
 * Un solo modal compartido por el detalle y el comparador. Sin datos personales
 * ni de pago: sólo producto, cadena, motivo y comentario opcional.
 */
import { $, esc } from './utils.js';
import { CHAIN_IDS, STORES } from './config.js';
import { loadState, updateState } from './storage.js';
import { sessionUser } from './auth.js';
import { getProduct } from './state.js';
import { REPORT_REASONS, canReport, createReport } from './reports.js';
import { trackEvent } from './analytics.js';
import { recordAudit } from './audit.js';
import { closeDialog, openDialog } from './a11y.js';

let notify = () => {};
let productId = null;
let bound = false;

function dialog() {
  return $('report-modal');
}

function setError(message) {
  const el = $('report-form-error');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

export function initReportUI(hooks = {}) {
  notify = hooks.notify || notify;
  if (bound) return;
  bound = true;

  $('close-report-modal').addEventListener('click', () => closeDialog(dialog()));
  $('cancel-report-btn').addEventListener('click', () => closeDialog(dialog()));
  dialog().addEventListener('click', (event) => {
    if (event.target === dialog()) closeDialog(dialog());
  });

  $('report-form').addEventListener('submit', (event) => {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const input = {
      productId,
      chain: form.elements.chain.value,
      reason: form.elements.reason.value,
      comment: form.elements.comment.value,
      userId: sessionUser(loadState())?.id || null,
    };
    const result = updateState((state) => {
      const created = createReport(state, input);
      if (created.ok) {
        trackEvent(state, 'report_price', { productId: input.productId, chain: input.chain });
        recordAudit(state, {
          who: input.userId || 'anonimo',
          role: 'viewer',
          action: 'reporte_creado',
          entity: 'report',
          entityId: created.report.id,
          after: { status: created.report.status, chain: input.chain },
        });
      }
      return created;
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    closeDialog(dialog());
    form.reset();
    notify('REPORTE GUARDADO · MODO PRUEBA');
  });
}

/** `chain` opcional preselecciona la cadena del precio reportado. */
export function openReportDialog(nextProductId, chain = '') {
  const product = getProduct(nextProductId);
  if (!product || !dialog()) return;
  productId = nextProductId;
  const available = CHAIN_IDS.filter((id) => product.prices?.[id] != null);
  const chains = available.length ? available : CHAIN_IDS;
  const defaultChain = chains.includes(chain) ? chain : chains[0] || '';

  $('report-product-name').textContent = product.name;
  $('report-chain').innerHTML = chains
    .map(
      (id) =>
        `<option value="${esc(id)}"${id === defaultChain ? ' selected' : ''}>${esc(STORES[id].name)}</option>`
    )
    .join('');
  $('report-reason').innerHTML = REPORT_REASONS.map(
    (item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`
  ).join('');
  $('report-comment').value = '';
  setError('');

  const limitNote = $('report-limit-note');
  if (limitNote) {
    const state = loadState();
    const user = sessionUser(state);
    limitNote.textContent = canReport(state, user?.id || null)
      ? 'Máximo 3 reportes por hora por usuario (control local en modo prueba).'
      : 'Límite local de 3 reportes por hora alcanzado. Inténtalo más tarde.';
  }
  openDialog(dialog(), 'report-reason');
}

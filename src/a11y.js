/**
 * UP · Accesibilidad de diálogos y teclado.
 * Sin dependencias: solo DOM y un WeakMap para devolver el foco al cerrar.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const previousFocus = new WeakMap();

export function visibleFocusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true'
  );
}

function anyDialogVisible() {
  return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(
    (el) => !el.classList.contains('hidden')
  );
}

export function openDialog(el, focusId) {
  if (!previousFocus.has(el)) previousFocus.set(el, document.activeElement);
  el.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const target = focusId ? document.getElementById(focusId) : null;
  const node = target || visibleFocusables(el)[0] || el;
  // requestAnimationFrame evita enfocar un nodo todavía oculto por CSS.
  requestAnimationFrame(() => node.focus({ preventScroll: true }));
}

export function closeDialog(el) {
  el.classList.add('hidden');
  if (!anyDialogVisible()) document.body.style.overflow = '';
  const previous = previousFocus.get(el);
  previousFocus.delete(el);
  // Restauración síncrona: evita que un rerender del modal vuelva a robar el foco.
  if (previous && document.contains(previous) && typeof previous.focus === 'function') {
    previous.focus({ preventScroll: true });
  }
}

/** Mantiene el foco dentro del diálogo visible (WCAG 2.1.2, sin trampa real: Escape siempre cierra). */
export function trapDialogTab(event) {
  if (event.key !== 'Tab') return false;
  // El diálogo activo es el último visible (el más reciente está por encima).
  const dialog = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
    .filter((el) => !el.classList.contains('hidden'))
    .at(-1);
  if (!dialog) return false;

  const items = visibleFocusables(dialog);
  if (!items.length) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

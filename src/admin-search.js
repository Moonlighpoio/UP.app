/**
 * UP · Buscador global del panel con Ctrl/⌘ + K (FASE P1).
 * El diálogo se crea bajo demanda para no añadir peso al primer paint.
 */
import { esc, norm } from './utils.js';
import { ADMIN_SECTIONS } from './admin.js';
import { closeDialog, openDialog } from './a11y.js';

export const ADMIN_COMMANDS = Object.freeze([
  ...ADMIN_SECTIONS,
  { id: 'inicio', label: 'Inicio de UP', route: '#/', hint: 'Catálogo' },
  { id: 'cuenta', label: 'Mi cuenta', route: '#/cuenta', hint: 'Sesión local' },
  { id: 'ayuda', label: 'Ayuda', route: '#/ayuda', hint: 'Preguntas frecuentes' },
]);

export function filterAdminCommands(query, commands = ADMIN_COMMANDS) {
  const needle = norm(query).trim();
  if (!needle) return [...commands];
  return commands.filter((item) =>
    norm(`${item.label} ${item.hint || ''} ${item.route}`).includes(needle)
  );
}

let modal = null;
let results = null;
let input = null;
let navigate = () => {};
let matches = [];
let activeIndex = 0;
let bound = false;

function optionId(index) {
  return `admin-search-option-${index}`;
}

function paintResults() {
  if (!results || !input) return;
  activeIndex = Math.max(0, Math.min(activeIndex, matches.length - 1));
  results.innerHTML = matches.length
    ? matches
        .map(
          (item, index) => `<li
            id="${optionId(index)}"
            class="up-admin-search-option"
            role="option"
            aria-selected="${index === activeIndex}"
          >
            <button type="button" data-admin-route="${esc(item.route)}">
              <strong>${esc(item.label)}</strong>
              <small>${esc(item.hint || item.route)}</small>
            </button>
          </li>`
        )
        .join('')
    : '<li class="up-admin-search-empty" role="presentation">Sin coincidencias.</li>';
  if (matches.length) input.setAttribute('aria-activedescendant', optionId(activeIndex));
  else input.removeAttribute('aria-activedescendant');
}

function update(query) {
  matches = filterAdminCommands(query);
  activeIndex = 0;
  paintResults();
}

function choose(index) {
  const target = matches[index];
  if (!target) return;
  closeDialog(modal);
  navigate(target.route);
}

function move(delta) {
  if (!matches.length) return;
  activeIndex = (activeIndex + delta + matches.length) % matches.length;
  paintResults();
  document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
}

function ensureModal() {
  if (modal || !document.body) return modal;
  modal = document.createElement('div');
  modal.id = 'admin-search-modal';
  modal.className = 'hidden up-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'admin-search-title');
  modal.innerHTML = `
    <div class="up-modal-card up-admin-search-card">
      <div class="up-modal-head">
        <div>
          <span class="up-eyebrow">ATAJOS DEL PANEL</span>
          <h2 id="admin-search-title">Buscar sección o acción</h2>
        </div>
        <button type="button" id="admin-search-close" class="up-icon-btn" aria-label="Cerrar buscador del panel">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M5 5l10 10M15 5L5 15" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="up-modal-body">
        <label class="up-field" for="admin-search-input">
          <span>Sección, ruta o acción</span>
          <input id="admin-search-input" type="search" autocomplete="off" role="combobox"
            aria-controls="admin-search-results" aria-expanded="true"
            placeholder="Ej.: catálogo, auditoría, pedidos" />
        </label>
        <p class="up-text-muted">Ctrl/⌘ + K abre · ↑/↓ elige · Enter abre · Esc cierra</p>
        <ul id="admin-search-results" class="up-admin-search-results" role="listbox"
          aria-label="Resultados del panel"></ul>
      </div>
    </div>`;
  document.body.appendChild(modal);
  input = modal.querySelector('#admin-search-input');
  results = modal.querySelector('#admin-search-results');
  modal.querySelector('#admin-search-close').addEventListener('click', () => closeDialog(modal));
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeDialog(modal);
    const button = event.target.closest('[data-admin-route]');
    if (button) {
      const index = matches.findIndex((item) => item.route === button.dataset.adminRoute);
      if (index !== -1) choose(index);
    }
  });
  input.addEventListener('input', () => update(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(modal);
    }
  });
  return modal;
}

function open() {
  if (!document.querySelector('.up-admin-layout')) return;
  ensureModal();
  if (!modal || !input) return;
  update('');
  input.value = '';
  openDialog(modal, 'admin-search-input');
}

export function mountAdminSearch(ctx = {}) {
  navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
  ensureModal();
  if (!bound) {
    bound = true;
    document.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        if (modal?.classList.contains('hidden')) open();
        else closeDialog(modal);
      }
    });
  }
  return {
    open,
    close: () => {
      if (modal && !modal.classList.contains('hidden')) closeDialog(modal);
    },
  };
}

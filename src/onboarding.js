/**
 * UP · Onboarding de primera visita en 3 pasos (FASE U6).
 * Comuna, cadenas preferidas y tipo de entrega. Omitible y reabrible desde
 * la cuenta. Guarda preferencias locales; la analítica no incluye la comuna.
 */
import { $, esc } from './utils.js';
import { STORES } from './config.js';
import { loadState, updateState } from './storage.js';
import { trackEvent } from './analytics.js';
import { openDialog, closeDialog } from './a11y.js';
import { RM_COMMUNES } from './delivery.js';
import { normalizePreferences, shouldShowOnboarding } from './preferences.js';

const STEP_IDS = {
  1: 'onboarding-title',
  2: 'onboarding-title',
  3: 'onboarding-title',
};
const STEP_TITLES = {
  1: 'Paso 1 de 3 · Tu comuna',
  2: 'Paso 2 de 3 · Cadenas preferidas',
  3: 'Paso 3 de 3 · Entrega',
};
let step = 1;
let opened = false;

function modal() {
  return $('onboarding-modal');
}

function readInput() {
  return {
    commune: $('onboarding-commune')?.value || '',
    chains: Array.from(
      document.querySelectorAll('#onboarding-chains input[type="checkbox"]:checked')
    ).map((input) => input.value),
    delivery:
      document.querySelector('input[name="onboarding-delivery"]:checked')?.value || 'despacho',
  };
}

function fillInput(preferences) {
  const clean = normalizePreferences(preferences);
  const commune = $('onboarding-commune');
  if (commune) commune.value = clean.commune;
  document.querySelectorAll('#onboarding-chains input[type="checkbox"]').forEach((input) => {
    input.checked = clean.chains.includes(input.value);
  });
  const delivery = document.querySelector(
    `input[name="onboarding-delivery"][value="${clean.delivery}"]`
  );
  if (delivery) delivery.checked = true;
}

function renderStep(next) {
  step = Math.max(1, Math.min(3, next));
  const title = $('onboarding-title');
  if (title) title.textContent = STEP_TITLES[step];
  document.querySelectorAll('[data-onboarding-step]').forEach((panel) => {
    panel.hidden = Number(panel.dataset.onboardingStep) !== step;
  });
  $('onboarding-back').hidden = step === 1;
  $('onboarding-next').hidden = step === 3;
  $('onboarding-finish').hidden = step !== 3;
  $('onboarding-progress').textContent = `Paso ${step} de 3`;
  requestAnimationFrame(() => $(STEP_IDS[step])?.focus({ preventScroll: true }));
}

function save(onboarded, eventName) {
  const raw = readInput();
  updateState((state) => {
    state.preferences = { ...normalizePreferences(raw), onboarded };
    trackEvent(state, eventName, {
      chains: state.preferences.chains.length,
      hasCommune: !!state.preferences.commune,
      delivery: state.preferences.delivery,
    });
  });
  closeDialog(modal());
  opened = false;
}

export function isOnboardingOpen() {
  return opened && !modal()?.classList.contains('hidden');
}

/** Abre el asistente; al cerrarlo se marca como omitido para no repetirlo. */
export function openOnboarding() {
  if (!modal()) return;
  fillInput(loadState().preferences);
  renderStep(1);
  opened = true;
  openDialog(modal(), 'onboarding-title');
}

export function closeOnboarding({ saveSkip = true } = {}) {
  if (!isOnboardingOpen()) return;
  if (saveSkip) save(false, 'onboarding_skipped');
  else {
    closeDialog(modal());
    opened = false;
  }
}

export function initOnboarding({ autoOpen = true } = {}) {
  const list = $('onboarding-chains');
  if (list) {
    list.innerHTML = Object.values(STORES)
      .map(
        (store) => `<label class="up-onboarding-chain">
          <input type="checkbox" value="${esc(store.id)}" />
          <span>${esc(store.name)}</span>
        </label>`
      )
      .join('');
  }
  const datalist = $('onboarding-commune-options');
  if (datalist) {
    datalist.innerHTML = RM_COMMUNES.map(
      (commune) => `<option value="${esc(commune)}"></option>`
    ).join('');
  }

  $('onboarding-close')?.addEventListener('click', () => closeOnboarding());
  $('onboarding-skip')?.addEventListener('click', () => closeOnboarding());
  $('onboarding-back')?.addEventListener('click', () => renderStep(step - 1));
  $('onboarding-next')?.addEventListener('click', () => renderStep(step + 1));
  $('onboarding-finish')?.addEventListener('click', () => save(true, 'onboarding_complete'));

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-onboarding]')) openOnboarding();
  });

  if (autoOpen && shouldShowOnboarding(loadState().preferences)) {
    setTimeout(() => {
      if (!opened && !document.querySelector('.up-modal:not(.hidden)')) openOnboarding();
    }, 900);
  }
}

/**
 * UP · Escáner de código de barras opcional (FASE U2).
 * Usa BarcodeDetector sólo si el navegador lo expone; si no, el botón queda
 * oculto y no se lanza ningún error. Alternativa manual por GTIN EAN-13.
 */
import { $ } from './utils.js';
import { closeDialog, openDialog } from './a11y.js';
import { isGtin13, productForGtin } from './suggest.js';
import { state } from './state.js';

let hooks = { onDetected: () => {}, notify: () => {} };
let stream = null;
let detector = null;
let raf = 0;
let running = false;

function status(message) {
  const el = $('scan-status');
  if (el) el.textContent = message;
}

export function stopScanner() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  const video = $('scan-video');
  if (video) {
    video.srcObject = null;
    video.hidden = true;
  }
}

function close() {
  stopScanner();
  closeDialog($('scan-modal'));
}

async function tick() {
  if (!running) return;
  const video = $('scan-video');
  if (video && video.readyState >= 2) {
    try {
      const results = await detector.detect(video);
      const code = results.find((item) => isGtin13(item.rawValue));
      if (code) {
        status(`Código detectado: ${code.rawValue}`);
        hooks.onDetected(code.rawValue);
        close();
        return;
      }
    } catch {
      // Un cuadro inválido no es un error de la aplicación.
    }
  }
  if (running) raf = requestAnimationFrame(tick);
}

async function startCamera() {
  const video = $('scan-video');
  status('Solicitando permiso de cámara…');
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    const supported = formats.filter((format) => /ean|upc|code_128/i.test(format));
    if (!supported.length) {
      status('Este navegador no reconoce códigos de barras de productos. Usa el GTIN manual.');
      return;
    }
    detector = new window.BarcodeDetector({ formats: supported });
    detector.getFormats = () => supported;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.hidden = false;
    video.srcObject = stream;
    await video.play();
    running = true;
    status('Apunta la cámara al código de barras del producto.');
    raf = requestAnimationFrame(tick);
  } catch {
    if (video) video.hidden = true;
    status('No se pudo usar la cámara. Puedes ingresar el GTIN manualmente.');
    hooks.notify('CÁMARA NO DISPONIBLE · USA EL GTIN MANUAL');
  }
}

export function initScanner(nextHooks = {}) {
  hooks = { ...hooks, ...nextHooks };
  const button = $('scan-btn');
  if (!button) return;
  const supported = typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';
  // El botón sigue disponible sin BarcodeDetector para no perder el ingreso manual.
  button.hidden = false;
  button.setAttribute('aria-label', 'Buscar por código de barras o GTIN');
  button.title = 'Buscar por código de barras o GTIN';

  button.addEventListener('click', () => {
    openDialog($('scan-modal'), 'scan-gtin');
    status('');
    if (supported) startCamera();
    else status('Este navegador no tiene escáner automático. Ingresa el GTIN manual.');
  });
  $('close-scan-modal').addEventListener('click', close);
  $('cancel-scan-btn').addEventListener('click', close);
  $('scan-modal').addEventListener('click', (event) => {
    if (event.target === $('scan-modal')) close();
  });
  $('scan-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = event.currentTarget.elements.gtin.value;
    const gtin = String(raw || '').replace(/[\s-]/g, '');
    if (!isGtin13(gtin)) {
      status('El GTIN debe tener 13 dígitos y un dígito verificador válido.');
      return;
    }
    const product = productForGtin(state.products, gtin);
    hooks.onDetected(product ? product.name : gtin);
    close();
    hooks.notify(product ? 'PRODUCTO ENCONTRADO POR GTIN' : 'GTIN VÁLIDO · SIN PRODUCTO MAPEADO');
  });
}

export function closeScanner() {
  if ($('scan-modal') && !$('scan-modal').classList.contains('hidden')) close();
}

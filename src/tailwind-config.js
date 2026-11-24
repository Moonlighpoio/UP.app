/**
 * UP · Configuración del CDN de Tailwind.
 * Se carga como script clásico inmediatamente después del CDN para preservar
 * el orden de ejecución original. No es lógica de la aplicación.
 */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        stage: '#000000',
        ink: '#040404',
        canvas: '#181818',
        utility: '#242424',
        panel: '#2e2e2e',
        chrome: '#3f4040',
        rule: '#595a5a',
        muted: '#9b9d9d',
        soft: '#d1d1d1',
        body: '#d8d9d9',
        signal: '#ffc700',
      },
      fontFamily: {
        serif: ['"Libre Caslon Text"', 'Georgia', 'serif'],
        dot: ['"DotGothic16"', 'monospace'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        sans: ['"Inter"', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        panel: '8px',
        control: '6px',
        action: '4px',
      },
    },
  },
};

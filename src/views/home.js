/** Vista de inicio: reutiliza el catálogo existente sin recrearlo. */
export const homeView = {
  element: 'view-home',
  render() {
    // El catálogo ya fue renderizado por src/main.js. Mantener el DOM evita
    // perder filtros, paginación y foco al volver desde otra ruta.
  },
  destroy() {},
};

/**
 * UP · Pedidos de ejemplo para cuentas nuevas.
 * Todos son ficticios y viajan con isDemo: true + etiqueta "Ejemplo".
 * No reproducen pedidos, direcciones ni precios reales de supermercados.
 */

export const DEMO_ADDRESS = Object.freeze({
  id: 'demo-direccion',
  label: 'Ejemplo',
  street: 'Dirección de ejemplo',
  commune: 'Providencia',
  isDemo: true,
});

function group(storeId, storeName, items, shipping, fee) {
  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  return {
    storeId,
    storeName,
    items,
    subtotal,
    shipping,
    fee,
    payout: subtotal - fee,
    total: subtotal + shipping,
  };
}

/** Devuelve copias frescas: nunca se comparte el array entre lecturas. */
export function createDemoOrders() {
  return [
    {
      id: 'UP-000123',
      isDemo: true,
      createdAt: '2026-11-22T10:15:00.000Z',
      deliveryMode: 'domicilio',
      address: { ...DEMO_ADDRESS },
      status: 'entregado',
      storeGroups: [
        group(
          'lider',
          'Lider',
          [
            {
              productId: 'coca-original-15l',
              name: 'Bebida Coca-Cola Original',
              qty: 2,
              unitPrice: 2190,
            },
            { productId: 'leche-entera-1l', name: 'Leche Colun Entera', qty: 2, unitPrice: 990 },
          ],
          3990,
          64
        ),
        group(
          'jumbo',
          'Jumbo',
          [
            {
              productId: 'arroz-1kg',
              name: 'Arroz Banquete Grado 1 Premium',
              qty: 1,
              unitPrice: 1890,
            },
          ],
          4490,
          19
        ),
      ],
      productsSubtotal: 8250,
      totalShipping: 8480,
      upFee: 83,
      grandTotal: 16730,
    },
    {
      id: 'UP-000098',
      isDemo: true,
      createdAt: '2026-11-18T17:40:00.000Z',
      deliveryMode: 'domicilio',
      address: { ...DEMO_ADDRESS },
      status: 'entregado',
      storeGroups: [
        group(
          'tottus',
          'Tottus',
          [
            { productId: 'leche-entera-1l', name: 'Leche Colun Entera', qty: 3, unitPrice: 969 },
            {
              productId: 'arroz-1kg',
              name: 'Arroz Banquete Grado 1 Premium',
              qty: 1,
              unitPrice: 1690,
            },
          ],
          3990,
          46
        ),
      ],
      productsSubtotal: 4597,
      totalShipping: 3990,
      upFee: 46,
      grandTotal: 8587,
    },
    {
      id: 'UP-000064',
      isDemo: true,
      createdAt: '2026-11-24T09:05:00.000Z',
      deliveryMode: 'retiro',
      address: { ...DEMO_ADDRESS },
      status: 'preparando',
      storeGroups: [
        group(
          'santaisabel',
          'Santa Isabel',
          [
            {
              productId: 'coca-original-15l',
              name: 'Bebida Coca-Cola Original',
              qty: 1,
              unitPrice: 2450,
            },
          ],
          3490,
          25
        ),
      ],
      productsSubtotal: 2450,
      totalShipping: 3490,
      upFee: 25,
      grandTotal: 5940,
    },
  ];
}

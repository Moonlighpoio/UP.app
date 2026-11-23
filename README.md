# UP · Prototipo de comparador de precios de supermercados (Chile)

Prototipo web **local y privado** de **UP**: busca entre **30 productos de despensa**, compara precios en **5 cadenas en la interfaz** (el feed de demo incluye 6 cadenas y 10 locales), arma **carritos múltiples visibles** separados por supermercado, muestra umbrales de despacho gratis y simula un **resumen de pago unificado** con **split payment 99% / 1%** (modelo **marketplace**, UP no es vendedor de los productos).

> ⚠️ **Estado de los datos:** precios **referenciales de demostración**, no precios en tiempo real. Ver [¿Por qué no hay conexión real ya?](#4-por-qué-no-hay-conexión-real-ya).
>
> 🔒 **Privacidad:** nada se publica en este momento. Las imágenes y descripciones son referencia privada de Jumbo.cl; los detalles legales y comerciales se resuelven después.

---

## Características críticas y flujo del usuario

1. **Catálogo amplio y categorías.** 30 productos de nueve categorías chilenas: Bebidas y Licores, Almacén / Despensa, Lácteos y Frescos, Carnes, Frutas y Verduras, Aseo y Limpieza, Cuidado Personal, Mascotas y Congelados. El selector de categoría filtra la búsqueda al instante.
2. **Búsqueda instantánea y órdenes.** Búsqueda por nombre, detalle, categoría y descripción; orden por **destacados**, **menor precio**, **mayor precio** y **mayor ahorro**. Filtro por categoría, con 10 chips (Todos + 9 categorías).
3. **Comparador por producto.** Al hacer clic en un producto se abre un modal con las **5 franquicias estrictamente ordenadas de menor a mayor precio**, con estado de verificación del enlace, `VER EN TIENDA ↗`, cantidad y `AGREGAR A UP` por fila.
4. **Deep linking by SKU con fallback exacto.** Cada oferta usa la **URL canónica** del mapeo `producto UP → SKU/GTIN de la cadena`. Si no hay URL canónica pero hay `sku` o `gtin`, se construye una **búsqueda exacta por ese identificador** (`busqueda?ft=`), **nunca por nombre genérico**. Si no hay identificador, aparece **“Sin SKU mapeado”** y el registro entra a la cola de re-indexación. Un 404 en la verificación marca `productId|chain` para re-indexación inmediata.
5. **Sincronización y refresco.** El botón **ACTUALIZAR PRECIOS** recarga `/api/prices`, actualiza precios y carrito de inmediato, y dispara verificación de enlaces canónicos en segundo plano; los fallos se marcan para re-indexación sin bloquear la interfaz.
6. **Carritos múltiples visibles.** Cada supermercado mantiene su subtotal, su despacho y su barra de progreso hacia el envío gratis, con el monto exacto que falta: *“Agrega $12.500 más en Jumbo para despacho gratis sobre $50.000”*.
7. **Checkout consolidado y comprobante split.** Un solo resumen con subtotales por cadena, despachos, comisión UP del 1% y un cargo final. **Confirmar pago** genera el **comprobante de boleta dividida**: 99% dispersado a supermercados, 1% retenido por UP, dispersión por franquicia y detalle de entrega coordinada.
8. **Avisos breves.** Los eventos usan un toast deslizante que desaparece solo; no hay popups persistentes ni avisos que bloqueen el catálogo.

> Implementado en un solo `index.html` (Tailwind CDN + JS inline: `offerLink`, `verifyLink`, `refreshPrices`, `openCompareModal`, `calculateCartTotals`, `processUnifiedCheckout`) y `server.js` (`/api/prices`, `/api/verify-link`).

---

## Arquitectura de sistema (producción)

### Principio

La plataforma no debe depender de un scraper que corre una vez al día. El diseño objetivo es **event-driven**, con microservicios de ingesta especializados por cadena y un **SLA de frescura de 15–30 minutos** entre que el supermercado cambia un precio y UP lo refleja.

### Flujo de datos

```
[ API / feed oficial de cadena ]     [ scraper autorizado y limitado ]
                │                                   │
                └──────────┬────────────────────────┘
                           ▼
             1. Conector por cadena (worker)
                           ▼
             2. Detector de cambios (ETag / Last-Modified / hash / updated_at)
                           ▼
             3. Bus de eventos (Kafka / SQS / PubSub)
                    price.changed · stock.changed · product.updated
                           ▼
             4. Normalizador (GTIN, marca, presentación, unidad, categoría)
                           ▼
             5. Price store (Postgres particionado) + Redis (hot path)
                           ▼
             6. Índice de búsqueda (OpenSearch / Algolia)
                           ▼
             7. API de lectura + servicio de verificación de enlaces
                           ▼
                    Web / App / futuros canales
```

**Detector de cambios:** en vez de descargar el catálogo completo, cada worker pide `If-None-Match` / `If-Modified-Since` o consume un feed delta. Si no hay cambio, la respuesta es `304` y no se escribe nada. Eso reduce el volumen de peticiones en órdenes de magnitud y es la principal defensa contra bloqueos.

### Deep linking: tabla de mapeo SKU → URL canónica

El trabajo principal del equipo de datos es mapear cada producto UP con el **SKU/GTIN de cada supermercado** y persistir su URL directa.

```
products(id, gtin, canonical_name, brand, category, ...)
sku_mapping(product_id, chain_id, retailer_sku, retailer_gtin, canonical_url,
            exact, verified_at, status)
```

**Reglas obligatorias:**

- Se usa **siempre** `sku_mapping.canonical_url` cuando existe; tiene prioridad y se verifica con `/api/verify-link`.
- Si no hay URL canónica pero hay `sku` o `gtin`, se genera una **búsqueda exacta por ese identificador** (`CHAIN_SEARCH` en el JS inline de `index.html`, patrón `busqueda?ft=`). La UI lo rotula **“Búsqueda SKU exacta”** y no lo trata como enlace roto aunque la cadena responda con un antibot.
- **Nunca** se genera una URL de búsqueda por nombre de producto.
- Si no hay URL ni SKU/GTIN, se muestra **“Sin SKU mapeado”** y se encola para re-indexación.
- Si `GET /api/verify-link` devuelve 404 u otro estado no OK, se marca `product_id + chain_id` para **re-indexación inmediata**. La fila se rotula **“⚠ Enlace roto · reindexar”** y el botón *Agregar* se deshabilita para no mostrar un precio engañoso.
- La URL se actualiza en la tabla, no se reconstruye con `slug + id` a ciegas, porque los slugs cambian cuando la cadena renueva su catálogo.

En el prototipo, los 30 productos tienen `sku`, `gtin`, `url`, `source` y `verifiedAt` en `product.skus.jumbo` (fichas públicas de Jumbo.cl capturadas el 23-11-2026). Las otras cadenas quedan con `sku/url: null` y son **pendientes de mapeo**; cuando se completa un SKU sin URL, se ejemplifica el fallback de búsqueda exacta.

### Carritos múltiples y pago unificado

- Cada cadena tiene su propio carrito lógico con **subtotal, despacho y umbral de despacho gratis**; el usuario decide completar una cadena u otra.
- El checkout genera un **Resumen de Pago Unificado**: una línea por cadena (`n productos · despacho · minutos`), subtotal de productos, despacho total, fee del 1% y un total final.
- **Matemática del fee (decisión vigente):** el 1% se **retiene del subtotal de productos**, no se agrega encima.
  - `platformFee = Σ round(subtotalPorCadena × 0.01)`
  - `payout = subtotalPorCadena − fee` (99% para la cadena)
  - `totalCobrado = subtotalProductos + despachoTotal`
- En producción el PSP dispersa automáticamente (Transbank/Kushki/Stripe/Mercado Pago); UP no recibe el valor de los productos para pagar después, porque eso la convertiría en vendedora (*merchant of record*).

### Concurrencia y sistemas antibot

No se proponen técnicas para evadir controles antibot. La estrategia es **reducir y legitimar el tráfico**:

- Priorizar **API oficial, feed de afiliado o convenio comercial** con cada cadena.
- Donde el acceso esté autorizado, usar **polling adaptativo con jitter**, límites por dominio y ventanas de silencio; nunca barridos agresivos.
- **Conditional requests** y caché local: si el recurso no cambió, no se reprocesa.
- **Worker pool con backpressure**, colas idempotentes por `GTIN + cadena + timestamp` y cola de reintentos con **backoff exponencial**.
- **Circuit breaker** por cadena: si el antibot responde 403/429 repetidamente, se pausa el conector y se alerta, en lugar de seguir insistiendo.
- **User-Agent identificable** y respeto estricto de `robots.txt` y términos de uso, igual que en el prototipo.

### Cobertura y volumen de catálogo

El alcance objetivo es la **despensa familiar chilena completa**, ya reflejada en las nueve categorías del prototipo:

| Categoría | Ejemplos en el prototipo |
|---|---|
| Bebidas y Licores | Coca-Cola Original/Zero, Benedictino 6,5 L |
| Almacén / Despensa | Arroz, aceite, café, azúcar, spaghetti, atún |
| Lácteos y Frescos | Leche Colun/Surlat, huevos, mantequilla, yogurt |
| Carnes | Pechuga de pollo, carne molida de vacuno |
| Frutas y Verduras | Palta, limón, tomate, papa, zanahoria, manzana |
| Aseo y Limpieza | Toalla de papel, papel higiénico, bolsas de basura, Cif |
| Cuidado Personal | Sérum Dove Derma Care |
| Mascotas | Dog Chow adulto 8 kg |
| Congelados | Choclo tierno La Crianza |

**Estimación:** 50.000–100.000 SKU por supermercado. Con 6 cadenas eso son ~450.000 productos canónicos y, si se expone por 10 locales por cadena, hasta **~4,5 millones de filas de oferta por local**.

**Estructura recomendada:**

- `products(gtin, canonical_name, brand, category_id, unit, image_url)`
- `stores(id, chain_id, comuna, lat, lng, delivery_minutes)`
- `offers(product_id, store_id, chain_id, price, available, source_url, captured_at)` — particionada por `chain_id` y `captured_at`
- `price_history(product_id, store_id, price, captured_at)` — serie temporal para gráficas y alertas
- Índices compuestos `(product_id, chain_id, captured_at DESC)` y `(chain_id, comuna)`
- Redis para búsquedas frecuentes y sesiones; OpenSearch con analyzer en español, facets, autocomplete y sinónimos ("maravilla" = "girasol")
- CDN para imágenes con redimensionamiento bajo demanda

### UX/UI mobile-first y búsqueda

- Diseñar primero para **320–390 px**: resultados en tarjetas, CTA fijo al bottom, filtros en bottom-sheet y tipografía legible sin zoom.
- Paleta monocromática con **un solo acento amarillo** reservado a estados activos, mejor precio, avisos clave y acción principal de compra. Nada de gradientes infantiles ni rotaciones decorativas.
- Transiciones cortas (150–200 ms), estados de carga skeleton y respuestas inmediatas al filtrar.
- La página de resultados permite ordenar por **precio, ahorro, disponibilidad, precio unitario, distancia y tiempo de despacho**, y filtrar por **categoría, cadena, oferta, stock, despacho gratis alcanzado y tiempo máximo de entrega**.

---

## Entregables y roadmap

| Fase | Entregable | Criterio de aceptación |
|---|---|---|
| **0 · Prototipo local** (hecho) | Web UP con logo, 30 productos, comparador por producto, deep links SKU/GTIN, refresco, carritos, checkout y comprobante split; toast no persistente | Corre en `localhost:3100` sin dependencias; 30 productos · 10 tiendas · 6 cadenas en el feed (5 en la UI); verificación 200/404 funcional |
| **1 · Datos y confianza** | Conectores autorizados, tabla `sku_mapping` + deep linker, `GET /api/verify-link`, frescura 15–30 min | ≥95% de ofertas con URL canónica y SKU válidos; re-indexación automática ante 404; TTL configurado |
| **2 · Catálogo completo** | 50k–100k SKU por cadena, normalización GTIN, OpenSearch, autocomplete | Búsqueda <200 ms p95; cobertura de las 9 categorías; facetas por cadena/comuna/unidad |
| **3 · UX mobile-first** | Web app responsive + diseño industrial-editorial, bottom-sheet de filtros, PWA | Lighthouse Performance ≥90 en móvil; flujo comparar→carrito→pago sin recargas |
| **4 · Checkout y logística** | PSP con split 99/1, emisión de boletas por cadena, factura de fee UP, orquestador de entregas | Un cargo al cliente, dispersión automática, boleta del supermercado + comprobante de fee; reconciliación diaria |
| **5 · Piloto y escalamiento** | Observabilidad, rate limiting por usuario, SLA y compliance SII/Ley 21.713 | Métricas de frescura y enlaces rotos; auditoría de vendedores; zero-downtime deploy |

> La fase 0 ya está implementada en esta carpeta. Las fases 1–5 son el roadmap de producción: requieren convenios con las cadenas y no se ejecutan en este prototipo privado.

---

## 1. Cómo abrirlo

### Opción A — Sin servidor (más rápida)
Abrir `index.html` con doble clic. Funciona con `data/demo.js`, pero sin `/api/verify-link` (los badges quedarán en “Verificar”). Requiere internet para Tailwind CDN y Google Fonts.

### Opción B — Con servidor local (recomendada)
```bash
cd ~/Desktop/UP-prototipo
PORT=3100 node server.js
```
Abrir **http://localhost:3100**. La cabecera muestra el indicador de sincronización y el botón **ACTUALIZAR PRECIOS**.

> En esta máquina el puerto **3000** está ocupado por otro servicio. Usa el lanzador **`start.command`** (doble clic) o el comando `PORT=3100 node server.js`.

Comprobar los endpoints:
```bash
curl 'http://localhost:3100/api/prices?q=leche'
curl 'http://localhost:3100/api/health'
curl 'http://localhost:3100/api/verify-link?url=https%3A%2F%2Fwww.jumbo.cl%2Fbusqueda%3Fft%3D391'
```

Respuesta esperada de `/api/prices`: `30 productos · 10 tiendas · 6 cadenas` en modo demo.

---

## 2. Estructura

```
UP-prototipo/
├── index.html                   # Interfaz + estilos Tailwind + JS inline (única fuente de UI)
├── server.js                    # Servidor Node sin dependencias + /api/prices + /api/verify-link
├── assets/
│   ├── up-logo.jpeg             # Copia del logo desde el Escritorio (referencia)
│   └── products/                # 30 imágenes de referencia guardadas localmente
├── data/
│   ├── demo.js                  # 30 productos · 10 locales · 6 cadenas
│   ├── live-prices.example.json # Plantilla documentada del formato real
│   └── live-prices.json         # (opcional) crearlo con datos reales para activar modo EN VIVO
├── styles.css                   # Legacy: sistema visual anterior, NO cargado por index.html
├── app.js                       # Legacy: lógica anterior, NO cargada por index.html
├── start.command                # Lanzador en puerto 3100
└── README.md
```

---

## 3. Cómo conectar supermercados reales

El prototipo ya tiene el **adaptador** listo. Hay tres caminos:

### 3.1 API oficial / convenio (recomendado)
```bash
UP_RETAILER_API=https://api.tucadena.cl/v1/precios PORT=3100 node server.js
```
El servidor llama `https://api.tucadena.cl/v1/precios?q=<búsqueda>` y espera el JSON con la forma descrita en `data/live-prices.example.json`.

### 3.2 Archivo de precios reales
```bash
cp data/live-prices.example.json data/live-prices.json
```
Editarlo con precios reales (obtenidos con autorización) y recargar. El badge pasará a `EN VIVO`.

### 3.3 Integración futura en producción

| Capa | Prototipo | Producción |
|---|---|---|
| Ingesta | `data/demo.js` (30 productos) | Conectores por cadena (API/feed) + normalización GTIN |
| Precios | Array en memoria + variación por local | Price store + historial + TTL 15–30 min |
| Búsqueda | Filtro JS instantáneo | OpenSearch / Algolia |
| Pagos | Modal simulado con comprobante split | PSP con split 99/1 (Mercado Pago 1:N / Webpay Mall) + DTE |
| Logística | Texto fijo por cadena | Order orchestrator + couriers + sustituciones |
| Verificación de enlaces | `GET /api/verify-link` bajo demanda + botón Refrescar | Link resolver + monitor de disponibilidad + alertas |

### 3.4 Deep linking y verificación del precio

El conector de datos debe entregar, **además del precio**, el SKU/GTIN y la URL dinámica precisa de la ficha. En el feed se representa así:

```json
"skus": {
  "lider": { "sku": "391", "gtin": "7801610001622", "url": null, "exact": true },
  "jumbo": {
    "sku": "391",
    "gtin": "7801610001622",
    "url": "https://www.jumbo.cl/bebida-coca-cola-15-l-botella-desechable/p",
    "exact": true,
    "verifiedAt": "2026-11-23"
  }
}
```

- Si hay `url`, se usa la **ficha canónica** (`VER EN TIENDA ↗`) y se verifica.
- Si no hay `url` pero hay `sku`/`gtin`, se genera una **búsqueda exacta** con el patrón de la cadena, p. ej. `https://www.jumbo.cl/busqueda?ft=391`. La UI la rotula **“Búsqueda SKU exacta”** y muestra el identificador usado. **Está prohibido buscar por nombre.**
- Si no hay ningún identificador, aparece **“Sin SKU mapeado”** y se encola para re-indexación.
- En el prototipo, el botón **Verificar** de cada fila (y el refresco global) llama a `GET /api/verify-link?url=...`. El servidor:
  1. valida que el dominio esté en una lista blanca de supermercados (evita SSRF);
  2. hace `HEAD` con timeout de 8 s y reintenta con `GET` si la tienda responde 403/405/501;
  3. guarda el resultado en caché por 5 minutos;
  4. devuelve `{ ok, status, finalUrl, checkedAt, cached }`.
- Si la URL canónica responde 404 u otro error, la fila se marca, aparece una alerta global, el texto pasa a **“Precio no confirmado”** y el botón *Agregar* se deshabilita. Las búsquedas SKU exactas no se marcan como rotas por respuestas antibot.

---

## 4. ¿Por qué no hay conexión real ya?

Verificado el 23-11-2026:

| Cadena | Resultado |
|---|---|
| **Jumbo** | Fichas y `busqueda?ft=` responden 200, pero su `robots.txt` deshabilita rutas de búsqueda amplias. Uso permitido solo como referencia privada. |
| **Santa Isabel** | Mismo motor VTEX: `busqueda?ft=` responde 200. Sin convenio no se usa para precios automáticos. |
| **Lider** | `robots.txt` deshabilita `/search*`, `/catalogo/product*` y `/supermercado/product*`; redirige en bucle a clientes no-browser (fila 302 a queue-it). |
| **Tottus** | Error TLS 526 desde este entorno. Su `robots.txt` permite búsqueda pero bloquea checkout/cuenta. |
| **Unimarc** | Responde **HTTP 403** y no publica `robots.txt` accesible. |
| **Coope** | No responde desde este entorno (000). |

**Conclusión:** no existe una API pública de precios y el scraping automático de esas rutas sería frágil y contractualmente riesgoso. Por eso el prototipo **no hace scraping oculto**: deja el adaptador listo y usa datos referenciales hasta que exista un convenio, feed de afiliado o archivo autorizado.

> Los precios de `data/demo.js` son referenciales: los productos iniciales se tomaron de fichas públicas de Jumbo.cl y el resto son ilustrativos. **No son una oferta comercial ni representan acuerdo con las cadenas.**

---

## 5. Notas legales (Chile)

- **Modelo tributario del prototipo (vigente):** **marketplace con split payment**. UP actúa como intermediario, no como vendedor de los productos. Cada supermercado emite la boleta electrónica por sus productos y UP emite una **liquidación-factura / factura por el servicio de intermediación** (fee del 1% **retenido del subtotal**, no cobrado adicionalmente). Referencia: art. 73 Reglamento LIVS; Res. Ex. SII N°38/2026 usa códigos F29 817/818 desde julio 2026.
- **Split payment:** la pasarela debe dispersar automáticamente a las cuentas de los supermercados. No se recomienda recibir el 100% en UP y pagar después: eso se acerca al modelo de reventa/*merchant of record* y traslada a UP la responsabilidad de venta, IVA y garantía. El despacho se paga íntegro a logística.
- **Ley 21.713 / Circular SII 38/2025:** si actúas como plataforma de intermediación, debes exigir inicio de actividades y verificar cumplimiento tributario de los vendedores (al inicio y semestralmente).
- **Sin wallet:** no retengas fondos de usuarios; eso puede activar obligaciones de medios de pago (Ley 21.713) y eventualmente Ley Fintech 21.521. Liquida vía PSP.
- **Consumidor:** Ley 19.496 + Ley 21.398 (información previa, retracto, garantía). Publicidad debe ir etiquetada.
- **Datos:** Ley 19.628 hoy; Ley 21.719 con vigencia postergada al 15-10-2027 (boletín 18.623-07, pendiente de publicación en Diario Oficial al cierre de este documento).

Esto no es asesoría legal ni tributaria.

---

## 6. Sistema visual · Nothing — Machines Meet Culture

Galería + manual de ingeniería: fría, precisa y monocromática. El amarillo `#ffc700` está reservado a **estados activos, mejor precio, avisos clave y acción principal de compra**; nunca decora.

### Tokens exactos (`:root` en `styles.css`)

```css
:root {
  --black: #000000;                    /* opening */
  --charcoal: #181818;                 /* capítulos */
  --near: #040404;                     /* cierre */
  --chrome: rgba(89, 90, 90, 0.6);     /* nav y dock, blur(45px) */
  --panel: rgba(60, 60, 60, 0.6);      /* tarjetas y paneles */
  --white: #ffffff;
  --body: #d8d9d9;
  --mute: #9b9d9d;
  --line: #595a5a;                     /* bordes 0.5px */
  --yellow: #ffc700;                   /* único acento */
  --radius-card: 8px;                  /* tarjetas / paneles / modales */
  --radius-control: 6px;               /* inputs, selects, icon buttons */
  --radius-action: 4px;                /* botones de acción */
  --font-serif: "Libre Caslon Text", Georgia, serif;
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --font-dot: "DotGothic16", "IBM Plex Mono", monospace;
}
```

- **Campo de puntos:** 1px cada 115px al 30% de opacidad (`radial-gradient`), solo en opening y cierre.
- **Vidrio:** `backdrop-filter: blur(45px)` en nav flotante, dock inferior, panel de filtros y modales.
- **Bordes:** `0.5px solid #595a5a` (o su variante translúcida). No existen radios `999px`.
- **Tipografía:** `Libre Caslon Text` en titulares, `Inter` en cuerpo, `IBM Plex Mono` en controles/etiquetas/precios y `DotGothic16` en la marca UP, nombres destacados y números de sección. Fuentes cargadas desde Google Fonts con *fallback* local, sin activos propietarios NType82/Geist/Ndot.
- **Formato de dinero:** CLP con `es-CL`, p. ej. `$1.890`.

### Estructura de la página

| Bloque | Tratamiento |
|---|---|
| **Opening** | Fondo `#000`, campo de puntos y un único objeto-interfaz centrado arriba: métrica de ahorro, buscador y chips populares. Navegación flotante de cromo helado con el logo UP. |
| **Dock inferior** | Barra fija de 56px, mismo vidrio, nombre `UP · PRICE ENGINE` en DotGothic16 y accesos `Overview / Specs / Carrito`. |
| **01 · Overview** | Barra de estado con badge de Demo/EN VIVO, indicador de sincronía, **Refrescar precios** y nota de datos. Filtros a la izquierda, resultados a la derecha, con comparador embebido por tarjeta. |
| **Capítulo 01 · La promesa** | Lienzo `#181818` tras 144px de espacio. Titular serif centrado y medio cinematográfico 16:9 con acción ligera blanca. |
| **Capítulo 02 · Mecánica** | Grilla de 12 columnas con tres bloques escalonados, números `(01)…` en DotGothic16 amarillo y puntos/líneas guía sobre las imágenes. Luego capítulos insertos de dos columnas sobre carritos y pago. |
| **Capítulo 03 · Cobertura** | Interludio 16:9, grilla de las 6 cadenas con umbrales de despacho y macro-fotografías de material con títulos serif. |
| **Capítulo 04 · Detalles** | Columna central con acordeón mono de 576px; solo un panel abierto a la vez. |
| **Cierre** | Near black `#040404`, familia de productos, botón señal amarillo de 48px y footer-instrumento con enlaces DotGothic16 y controles de 48px. |

El logo `assets/up-logo.jpeg` se invierte y se mezcla con `screen` dentro de la barra cromo para que el fondo claro del JPEG desaparezca sobre el vidrio oscuro.

> El interludio "humano" y las macro-fotografías se aproximan con las imágenes de producto disponibles y tratamientos `grayscale`/contraste. Para una versión final se deben reemplazar por fotografía propia con iluminación rim-lit y escala humana real.

---

## 7. Avisos, imágenes y catálogo

### Avisos descartables
Los avisos de "MODO DEMO", la nota del footer y la nota legal del checkout tienen una **✕** que los oculta. La preferencia queda guardada en `localStorage` (`up.hiddenNotices`) y **“Mostrar avisos”** en el footer los restaura. La explicación de datos reales vive en el botón **ⓘ** del comparador y en **⟳ Refrescar precios**, sin popups persistentes.

### Catálogo de 30 productos

| Categoría | Productos |
|---|---|
| Bebidas y Licores | Coca-Cola Original 1,5 L · Coca-Cola Zero 1,5 L · Agua Benedictino Sin Gas 6,5 L |
| Almacén / Despensa | Arroz Banquete 1 kg · Aceite de Maravilla Chef 1 L · Café Gold Premier Forte 230 g · Azúcar Iansa 1 kg · Spaghetti Talliani N°5 400 g · Atún Lomitos en Agua 91 g |
| Lácteos y Frescos | Leche Colun Entera 1 L · Huevos Cintazul 12 un. · Mantequilla Colun 250 g · Leche Surlat Descremada Sin Lactosa 1 L · Yogurt Griego Danone Oikos 150 g |
| Carnes | Pechuga Deshuesada de Pollo 850 g · Carne Molida Vacuno 10% 500 g |
| Frutas y Verduras | Palta Hass 2 un. · Limón Malla 1 kg · Tomate Larga Vida Granel · Papa Malla 2 kg · Zanahoria Bolsa 1 kg · Manzana Fuji Granel |
| Aseo y Limpieza | Toalla de Papel Nova 26 m 2 un. · Papel Higiénico Elite 18 rollos · Bolsas de Basura Virutex 10 un. · Limpiador Crema Cif 500 ml |
| Cuidado Personal | Sérum Dove Derma Care Anti-Caída 50 ml |
| Mascotas | Alimento Perro Adulto Dog Chow 8 kg |
| Congelados | Choclo Tierno La Crianza 400 g |

### Imágenes y descripciones de referencia
Los 30 productos incluyen `image`, `description` y `source` (cadena, fecha y URL de origen). Las imágenes se descargaron a `assets/products/` para que el prototipo funcione sin depender del CDN de Jumbo.

> ⚠️ **Uso estrictamente privado:** las imágenes y los textos pertenecen a sus respectivos titulares y se usan solo como referencia visual en este prototipo local. **No publicar, distribuir ni usar con fines comerciales** sin autorización. Para producción se deben reemplazar por fotos y textos propios o licenciados.

### Mejoras funcionales del prototipo
- Búsqueda instantánea por nombre, detalle, categoría y descripción.
- Comparador modal por producto con **todas las cadenas ordenadas por precio ascendente** y `AGREGAR AL CARRITO` por fila.
- Refresco global y por comparador: vuelve a consultar el feed, revalida enlaces y actualiza precios del carrito.
- Cada tarjeta muestra imagen, descripción, mejor precio, rango y estado de verificación del enlace.
- Miniaturas en el carrito y barra de envío gratis con monto faltante y umbral.
- Comprobante de split payment imprimible con dispersión por franquicia y entrega coordinada.

---

## 8. Desafíos de la verificación en tiempo real

1. **URLs dinámicas y volátiles.** El slug de una ficha cambia cuando la cadena renueva su catálogo. El conector debe persistir `productId + GTIN + URL` y actualizarla, no reconstruirla a ciegas.
2. **Bloqueos y robots.** Varias cadenas deshabilitan rutas de búsqueda o responden 403 a clientes automatizados. Por eso la verificación es **bajo demanda**, con User-Agent identificable, timeout y caché; nunca se hace scraping oculto masivo.
3. **Falsos 404.** Un 403/405 puede significar "bloqueo", no "producto inexistente". El servidor reintenta con `GET` antes de declarar el enlace roto.
4. **Coherencia precio ↔ ficha.** Que el enlace exista no garantiza que el precio siga siendo el mismo. En producción el precio debe venir del mismo feed que entrega la URL, con `capturedAt` y TTL corto; la verificación es una capa adicional de confianza, no un reemplazo del feed.
5. **CORS y latencia.** El navegador no puede consultar directamente jumbo.cl/lider.cl por CORS. La verificación pasa por el backend, con lista blanca de dominios para evitar SSRF.
6. **Sin búsqueda genérica.** El fallback permitido es **solo búsqueda exacta por SKU/GTIN** (`busqueda?ft=`). Si no hay identificador, se muestra “Sin SKU mapeado” y se encola para re-indexación: nunca se arma una URL con el nombre del producto.
7. **Costo y abuso.** Cachear 5 minutos y limitar dominios evita floods de peticiones. En producción se agregaría rate limiting por usuario y métricas de enlaces rotos.
8. **Alta concurrencia con frescura de 15–30 min.** Mantener ~450.000 SKU actualizados exige detectar cambios en vez de descargar todo: conditional requests, feeds delta, workers con backpressure y particionado por cadena. El cuello de botella no es el usuario, sino el volumen de observación del catálogo.
9. **Antibots sin evasión.** Un 403/429 debe interpretarse como una señal para pausar y renegociar acceso, nunca como un obstáculo técnico a sortear. Circuit breakers por cadena y User-Agent identificable son parte del diseño.
10. **Búsqueda instantánea a escala.** Con millones de ofertas, el filtro en memoria del prototipo no sirve. Se requiere OpenSearch/Algolia con analyzer en español, facetas y autocomplete, más Redis para consultas calientes.

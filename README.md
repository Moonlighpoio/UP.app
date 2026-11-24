# UP · Prototipo de comparador de precios de supermercados (Chile)

[![CI](https://github.com/Moonlighpoio/UP.app/actions/workflows/ci.yml/badge.svg)](https://github.com/Moonlighpoio/UP.app/actions/workflows/ci.yml)
[![Demo](https://img.shields.io/website?url=https%3A%2F%2Fmoonlighpoio.github.io%2FUP.app%2F&label=demo&up_message=online&down_message=offline)](https://moonlighpoio.github.io/UP.app/)
[![Licencia](https://img.shields.io/badge/licencia-propietaria-dark)](LICENSE)

Prototipo web de demostración de **UP**: busca entre **30 productos de despensa**, compara precios en **5 cadenas en la interfaz** (el feed de demo incluye 6 cadenas y 10 locales), arma **carritos múltiples visibles** separados por supermercado, muestra umbrales de despacho gratis y simula un **resumen de pago unificado** con **split payment 99% / 1%** (modelo **marketplace**, UP no es vendedor de los productos).

> ⚠️ **Estado de los datos:** precios **referenciales de demostración**, no precios en tiempo real. Ver [¿Por qué no hay conexión real ya?](#4-por-qué-no-hay-conexión-real-ya).
>
> 🌐 **Demo pública (GitHub Pages):** https://moonlighpoio.github.io/UP.app/ · Repo: https://github.com/Moonlighpoio/UP.app. En Pages se activa automáticamente el **modo demo estático**: usa `data/demo.js`, no llama a `/api/prices` ni a `/api/verify-link`, y los badges muestran `Demo · sin verificación` en lugar de marcar enlaces como rotos.
>
> 🔒 **Privacidad y contenidos:** el repo y la demo son públicos para recibir opiniones. Las imágenes son ilustraciones SVG propias y las descripciones son textos neutrales creados por UP; ya no se incluyen fotos ni textos copiados de fichas de supermercados. Los nombres, SKU/GTIN y URLs canónicas siguen siendo datos de referencia necesarios para el *deep link*. Ver [Imágenes, textos y origen de los datos](#imágenes-textos-y-origen-de-los-datos). **Esto no es asesoría legal.**

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

> Implementado en **módulos ES nativos** bajo `src/` (sin bundler): `api.js`, `links.js`, `cart.js`, `compare.js`, `checkout.js`, `ui.js`, más `state.js` (estado central), `config.js`, `catalog.js`, `utils.js` y `main.js` (entrada). `index.html` solo contiene el marcado; `styles.css` tiene los tokens y estilos propios; `server.js` expone `/api/prices`, `/api/verify-link` y `/api/health`. En GitHub Pages se detecta el host `github.io` y se usa el catálogo estático sin depender del servidor local.

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
- Si no hay URL canónica pero hay `sku` o `gtin`, se genera una **búsqueda exacta por ese identificador** (`CHAIN_SEARCH` en `src/links.js`, patrón `busqueda?ft=`). La UI lo rotula **“Búsqueda SKU exacta”** y no lo trata como enlace roto aunque la cadena responda con un antibot.
- **Nunca** se genera una URL de búsqueda por nombre de producto.
- Si no hay URL ni SKU/GTIN, se muestra **“Sin SKU mapeado”** y se encola para re-indexación.
- Si `GET /api/verify-link` devuelve 404 u otro estado no OK, se marca `product_id + chain_id` para **re-indexación inmediata**. La fila se rotula **“⚠ Enlace roto · reindexar”** y el botón *Agregar* se deshabilita para no mostrar un precio engañoso.
- La URL se actualiza en la tabla, no se reconstruye con `slug + id` a ciegas, porque los slugs cambian cuando la cadena renueva su catálogo.

En el prototipo, los 30 productos tienen `sku`, `gtin`, `url` y `verifiedAt` en `product.skus.jumbo` como **referencia de *deep link***, sin haber copiado el contenido de esas fichas. Las otras cadenas quedan con `sku/url: null` y son **pendientes de mapeo**; cuando se completa un SKU sin URL, se ejemplifica el fallback de búsqueda exacta.

### Carritos múltiples y pago unificado

- Cada cadena tiene su propio carrito lógico con **subtotal, despacho y umbral de despacho gratis**; el usuario decide completar una cadena u otra.
- El checkout genera un **Resumen de Pago Unificado**: una línea por cadena (`n productos · despacho · minutos`), subtotal de productos, despacho total, fee del 1% y un total final.
- **Matemática del fee (decisión vigente):** el 1% se **retiene del subtotal de productos**, no se agrega encima.
  - `platformFee = Σ round(subtotalPorCadena × 0.01)`
  - `payout = subtotalPorCadena − fee` (99% para la cadena)
  - `totalCobrado = subtotalProductos + despachoTotal`

**Ejemplo numérico.** Carrito con $1.250 en Lider y $1.250 en Tottus, ambos con despacho de $3.990 (umbral de $50.000 no alcanzado):

| Concepto | Cálculo | Valor |
|---|---|---|
| Subtotal Lider | — | $1.250 |
| Subtotal Tottus | — | $1.250 |
| Fee Lider | `round(1.250 × 0,01)` = `round(12,5)` | $13 |
| Fee Tottus | `round(1.250 × 0,01)` = `round(12,5)` | $13 |
| **Fee UP total** | `13 + 13` (no `round(2.500 × 0,01) = 25`) | **$26** |
| Payout a tiendas | `2.500 − 26` | $2.474 |
| Despacho total | `3.990 + 3.990` | $7.980 |
| **Total que paga el cliente** | `2.500 + 7.980` (fee **no** se suma) | **$10.480** |

> El redondeo se hace **por cadena**, por eso el fee total ($26) puede diferir de redondear el subtotal agregado ($25). El cliente paga productos + despacho; el 1% se descuenta de la liquidación a las cadenas. Estas funciones puras viven en `src/money.js` y están cubiertas por `npm test`.

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
- La página de resultados permite ordenar por **precio, ahorro y precio unitario** (ya implementado), y filtrar por **categoría, cadena y despacho gratis alcanzado** (ya implementado). La visión de producción agrega disponibilidad, distancia, tiempo de despacho, ofertas, stock y tiempo máximo de entrega. Ver [§11](#11-filtros-y-orden-avanzado).

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

> La fase 0 ya está implementada en este repositorio. Las fases 1–5 son el roadmap de producción: requieren convenios con las cadenas y no se ejecutan en este prototipo de demostración.

---

## 1. Cómo abrirlo

### Opción A — Demo estática en GitHub Pages (sin servidor)
Visitar **https://moonlighpoio.github.io/UP.app/**. Usa `data/demo.js`, no llama a `/api/*` y los badges muestran `Demo · sin verificación`. Requiere internet para Tailwind CDN y Google Fonts.

> ℹ️ **Nota:** al usar módulos ES nativos, abrir `index.html` con doble clic (`file://`) ya no funciona en Chrome/Firefox por las restricciones CORS del navegador. Para probar en local usa la Opción B.

### Opción B — Con servidor local (recomendada)
```bash
npm start
```
Abrir **http://localhost:3100**. El servidor escucha en el puerto `3100` por defecto; puedes cambiarlo con `PORT=4000 npm start`. La cabecera muestra el indicador de sincronización y el botón **ACTUALIZAR PRECIOS**. En macOS también puedes usar `start.command` (doble clic), que equivale a `npm start`.

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
UP.app/
├── index.html                   # Solo marcado UI + Tailwind por CDN
├── styles.css                   # Tokens de diseño y estilos propios, cargados por index.html
├── src/
│   ├── package.json             # {"type":"module"}: ESM en src/, CJS en server.js
│   ├── tailwind-config.js       # Config del CDN (script clásico)
│   ├── main.js                  # Entrada: cablea módulos y eventos
│   ├── config.js                # Cadenas, umbrales, fee y detección de modo demo
│   ├── state.js                 # Estado central: catálogo, filtros, carrito, verificación
│   ├── catalog.js               # Normalización, estadísticas y precio unitario
│   ├── api.js                   # /api/prices y refreshPrices; modo estático
│   ├── links.js                 # CHAIN_SEARCH, offerLink, verifyLink
│   ├── cart.js                  # Carrito: resuelve productos y delega en money.js
│   ├── money.js                 # Matemática de dinero pura (fee, payout, totales, CLP)
│   ├── filters.js               # Filtros por cadena/despacho y orden (incluye precio unitario)
│   ├── compare.js               # Modal comparador con precio por unidad por cadena
│   ├── checkout.js              # Checkout simulado y split 99%/1%
│   ├── ui.js                    # Toasts, render y paneles
│   └── utils.js                 # Helpers puros de UI
├── server.js                    # Servidor Node sin dependencias + /api/prices + /api/verify-link
├── package.json                 # Scripts start / test / lint / format; devDependencies ESLint + Prettier
├── package-lock.json            # Lockfile para npm ci reproducible en CI
├── eslint.config.js             # ESLint 9 flat config, sin plugins externos
├── .prettierrc.json             # Reglas de formato (100 columnas, comillas simples)
├── .github/workflows/ci.yml     # CI: npm ci + lint + format:check + test
├── .gitignore                   # Ignora dependencias, entorno y datos reales opcionales
├── .nojekyll                    # Evita el procesamiento Jekyll en GitHub Pages
├── LICENSE                      # Todos los derechos reservados
├── start.command                # Lanzador macOS equivalente a npm start
├── assets/
│   ├── up-logo.jpeg             # Referencia visual del logotipo
│   └── products/                # 9 ilustraciones SVG propias (una por categoría)
├── data/
│   ├── demo.js                  # 30 productos · 10 locales · 6 cadenas
│   ├── live-prices.example.json # Plantilla documentada del formato real
│   └── live-prices.json         # (opcional, ignorado por git) activa el modo EN VIVO
├── test/
│   ├── money.test.js            # Dinero puro, redondeo y formato CLP
│   ├── links.test.js            # Canónica, SKU/GTIN y nunca por nombre
│   ├── catalog.test.js          # Heurística de unidades y precio unitario
│   ├── filters.test.js          # Cadena, despacho gratis, precios y orden
│   ├── server.test.js           # /api/*, SSRF, caché, HEAD→GET, saltos, rate limit y headers
│   ├── security.test.js         # Saneamiento de URLs y escape HTML
│   └── package.json             # {"type":"module"} para los tests ESM
└── README.md
```

> No quedan archivos legacy ni JS de aplicación inline en `index.html`; `app.js` y la versión anterior de `styles.css` ya no existen.

---

## 3. Cómo conectar supermercados reales

El prototipo ya tiene el **adaptador** listo. Hay tres caminos:

### 3.1 API oficial / convenio (recomendado)
```bash
UP_RETAILER_API=https://api.tucadena.cl/v1/precios npm start
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
  2. usa `redirect: 'manual'` y valida **cada salto** contra la whitelist (máx. 5) **antes de contactarlo**; una URL relativa se resuelve contra el salto actual;
  3. hace `HEAD` con un timeout único de 8 s y reintenta con `GET` si la tienda responde 403/405/501;
  4. guarda el resultado en caché por 5 minutos;
  5. limita a **10 verificaciones/minuto por IP** (HTTP 429 + `Retry-After`);
  6. devuelve `{ ok, status, finalUrl, hops, checkedAt, cached }`.
- Si la URL canónica responde 404 u otro error, la fila se marca, aparece una alerta global, el texto pasa a **“Precio no confirmado”** y el botón *Agregar* se deshabilita. Las búsquedas SKU exactas no se marcan como rotas por respuestas antibot.

---

## 4. ¿Por qué no hay conexión real ya?

Verificado el 23-11-2026:

| Cadena | Resultado |
|---|---|
| **Jumbo** | Fichas y `busqueda?ft=` responden 200, pero su `robots.txt` deshabilita rutas de búsqueda amplias. No se copia contenido de sus fichas; solo se conservan URLs canónicas como referencia de *deep link*. |
| **Santa Isabel** | Mismo motor VTEX: `busqueda?ft=` responde 200. Sin convenio no se usa para precios automáticos. |
| **Lider** | `robots.txt` deshabilita `/search*`, `/catalogo/product*` y `/supermercado/product*`; redirige en bucle a clientes no-browser (fila 302 a queue-it). |
| **Tottus** | Error TLS 526 desde este entorno. Su `robots.txt` permite búsqueda pero bloquea checkout/cuenta. |
| **Unimarc** | Responde **HTTP 403** y no publica `robots.txt` accesible. |
| **Coope** | No responde desde este entorno (000). |

**Conclusión:** no existe una API pública de precios y el scraping automático de esas rutas sería frágil y contractualmente riesgoso. Por eso el prototipo **no hace scraping oculto**: deja el adaptador listo y usa datos referenciales hasta que exista un convenio, feed de afiliado o archivo autorizado.

> Los precios de `data/demo.js` son **ilustrativos y referenciales**, generados para la demo. **No son una oferta comercial ni representan acuerdo con las cadenas.** Los nombres y SKU/GTIN son datos de referencia para el comparador; las marcas pertenecen a sus titulares.

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

> Las antes denominadas macro-fotografías son ahora **ilustraciones SVG propias** por categoría, sin uso de imágenes de terceros. Para una versión final se pueden reemplazar por fotografía propia con iluminación rim-lit y escala humana real.

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

### Imágenes, textos y origen de los datos

Los 30 productos incluyen `image` e `description` propios. Las fotos y textos de fichas comerciales fueron **eliminados** del repositorio.

| Dato | Origen / tratamiento |
|---|---|
| Nombres y presentaciones | Datos de referencia del prototipo. Las marcas mencionadas pertenecen a sus titulares. |
| Precios | Ilustrativos, generados para la demo. No son oferta comercial. |
| Imágenes | **Ilustraciones SVG propias** por categoría en `assets/products/*.svg`. |
| Descripciones | **Texto neutral creado por UP**, sin copiar fichas de supermercados. |
| `sku` / `gtin` / URL canónica | Referencias de *deep link*; no se copia el contenido de las páginas destino. |
| `source` (cadena/fecha de captura) | Eliminado: ya no se registra procedencia de terceros. |
| Paleta, íconos y SVG | Creados para este prototipo bajo el sistema visual negro/amarillo `#ffc700`. |

> ⚠️ **Aviso legal:** este proyecto **no constituye asesoría legal**. El uso de marcas, URLs canónicas, precios referenciales y la publicación de la demo debe ser revisado por un abogado antes de cualquier uso comercial o acuerdo con las cadenas. Ver `LICENSE` (todos los derechos reservados).

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
7. **Costo y abuso.** Cachear 5 minutos, limitar dominios, validar cada redirección y aplicar rate limiting por IP (10/min en verificaciones, 60/min en precios) evita floods de peticiones. En producción se agregaría además rate limiting por usuario autenticado y métricas de enlaces rotos.
8. **Alta concurrencia con frescura de 15–30 min.** Mantener ~450.000 SKU actualizados exige detectar cambios en vez de descargar todo: conditional requests, feeds delta, workers con backpressure y particionado por cadena. El cuello de botella no es el usuario, sino el volumen de observación del catálogo.
9. **Antibots sin evasión.** Un 403/429 debe interpretarse como una señal para pausar y renegociar acceso, nunca como un obstáculo técnico a sortear. Circuit breakers por cadena y User-Agent identificable son parte del diseño.
10. **Búsqueda instantánea a escala.** Con millones de ofertas, el filtro en memoria del prototipo no sirve. Se requiere OpenSearch/Algolia con analyzer en español, facetas y autocomplete, más Redis para consultas calientes.

---

## 10. Seguridad y robustez del servidor

| Medida | Implementación | Detalle |
|---|---|---|
| **SSRF** | Whitelist de dominios + `redirect: 'manual'` | Se valida cada salto (máx. 5) **antes** de hacer la petición; se rechazan IPs internas, `file://`, `jumbo.cl.evil.com` y saltos relativos hostiles. |
| **Timeout único** | `NETWORK_TIMEOUT_MS = 8000` | Mismo `AbortController` para `HEAD`, `GET` y el feed externo; evita peticiones colgadas. |
| **Rate limiting** | Por IP de socket | 10 verificaciones y 60 consultas de precios por minuto. Excederlo responde `429` con `Retry-After`. No se confía en `X-Forwarded-For` (spoofable). |
| **Headers de seguridad** | En **todas** las respuestas | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` y CSP. Se eliminó `Access-Control-Allow-Origin: *`: el consumo es mismo origen. |
| **Saneamiento DOM** | `esc`, `safeHttpUrl`, `safeAssetUrl` | Todo texto se escapa antes de `innerHTML`; los `href` solo aceptan `http/https`; las imágenes solo rutas `assets/...` o `http(s)`. Los SKU se codifican con `encodeURIComponent`. |

El CSP del servidor local permite explícitamente el CDN de Tailwind, Google Fonts y los estilos inline generados por el CDN. Verificado con Chrome headless: mismos estilos calculados y mismo flujo que antes del header (`cardBg rgb(20, 20, 20)`, `Libre Caslon Text`, `DotGothic16`, 30 tarjetas, 5 filas, `$2.090 / $21 / $6.080`).

> ⚠️ **Alcance:** estos headers los envía **`node server.js` / `npm start`**. GitHub Pages es hosting estático y no permite cabeceras personalizadas en este repo, así que la demo pública no los recibe; por eso el front-end mantiene su propio saneamiento y no depende de `/api/*` en Pages.

La suite completa tiene **50 tests**; la cobertura de esta fase incluye salto hostil no contactado, límite de redirecciones, 3xx sin `Location`, `429` real por HTTP, buckets independientes y presencia de headers.

---

## 9. Calidad y CI

Dos **devDependencies** (justificadas): `eslint@9` detecta errores y variables sin uso, y `prettier@3` mantiene un formato único. `node:test` y `node:assert` son nativos, por eso los tests no agregan paquetes.

```bash
npm ci             # instala exactamente lo del lockfile (equivale a lo que hace CI)
npm run lint       # node --check + ESLint (sintaxis + reglas)
npm run format:check  # verifica formato sin modificar archivos
npm test           # 50 tests: dinero, deep links, servidor, seguridad y filtros
npm run format     # aplica Prettier a src/, test/ y eslint.config.js
```

El workflow `.github/workflows/ci.yml` corre en **cada push y pull request** con Node 20: `npm ci` → `npm run lint` → `npm run format:check` → `npm test`. El badge de CI está arriba de este README; el badge de Demo consulta la URL pública.

> ℹ️ Se mantiene **ESLint 9** por la decisión aprobada. npm avisa que la rama 9 está deprecated (latest: 10.x, que exige Node ≥20.19); la actualización a 10 queda como decisión futura y no afecta al prototipo ni a la CI con Node 20.

### Despliegue de la demo (GitHub Pages)

El sitio **ya está publicado** en https://moonlighpoio.github.io/UP.app/ desde el repo público `Moonlighpoio/UP.app`. La fuente de deployment es la rama, no un workflow de Pages; no cambiarla evita interrumpir la demo:

1. En el repo: **Settings → Pages**.
2. En *Build and deployment*: **Source = Deploy from a branch**.
3. **Branch = `main`**, carpeta **`/ (root)`** → **Save**.
4. El archivo `.nojekyll` en la raíz evita que Jekyll ignore carpetas como `src/`.
5. Cada push a `main` dispara un rebuild automático (1–2 min). Para comprobarlo:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -L https://moonlighpoio.github.io/UP.app/
curl -sS -o /dev/null -w '%{http_code}\n' https://moonlighpoio.github.io/UP.app/src/main.js
gh api repos/Moonlighpoio/UP.app/actions/workflows/ci.yml/runs --jq '.workflow_runs[0] | {status, conclusion, head_sha}'
```

> La API de builds de Pages puede mostrar metadata desfasada justo después de un push. Si el `status`/`commit` parece viejo, valida el **contenido servido** (por ejemplo, que `index.html` apunte a `src/main.js`) en vez de fiarte solo de la API.

En Pages el front-end detecta el host `github.io` y activa el **modo demo estático**: no existen `/api/*`, así que usa `data/demo.js` y no marca enlaces como rotos. El servidor Node (`npm start`, puerto `3100`) es la única forma de ejercitar `/api/prices`, `/api/health` y `/api/verify-link` en local.

---

## 11. Filtros y orden avanzado

La lógica vive en `src/filters.js`; la UI solo renderiza el resultado y cablea los controles. Todo se aplica al instante, sin recargas ni dependencias nuevas.

| Control | Semántica |
|---|---|
| `#chain-filter` | `selectedChain` deja pasar solo productos con precio en esa cadena. La tarjeta muestra `PRECIO (CADENA)` en vez de `DESDE (MEJOR CADENA)`. |
| `#free-shipping-toggle` | `freeShippingOnly` usa las cadenas cuyo carrito ya superó su umbral. Si ninguna califica, el botón no se activa y muestra el toast `AGREGA PRODUCTOS PARA DESBLOQUEAR DESPACHO GRATIS`. Si el carrito baja del umbral, `syncFreeShippingFilter()` apaga el filtro solo. |
| `option value="unit-asc"` | Ordena por **precio unitario** calculado sobre el precio visible (el de la cadena elegida o el mejor). |
| `reset-filters-btn` | Restaura categoría, búsqueda, cadena, despacho gratis y orden. |

**Heurística de precio unitario** (`unitInfo` en `src/catalog.js`): se extrae la primera cantidad con unidad reconocida del texto del detalle, con prioridad `kg > g > L > ml > m > un`. Gramos y mililitros se expresan **por 100** (`/100 g`, `/100 ml`); kilos, litros, metros y unidades se expresan por 1 (`/kg`, `/L`, `/m`, `/un`). Formatos como `Bidón 6,5 L`, `Bolsa 500 g` o `18 rollos · 50 m c/u` se normalizan; si no hay unidad reconocida, la tarjeta simplemente no muestra línea unitaria y el orden la deja al final.

> ℹ️ En el feed de demo los 30 productos tienen precio en las 5 cadenas visibles: filtrar por cadena no reduce el conteo, pero **sí cambia el precio y la cadena mostrados**. Los tests de `test/filters.test.js` cubren el caso general con un fixture donde sí hay productos sin precio en la cadena elegida.

Verificación headless frente al baseline `8258045`: mismos estilos y flujo (`cardBg rgb(20, 20, 20)`, `Libre Caslon Text`, `DotGothic16`, 30 tarjetas, 5 filas, `$2.090 / $21 / $3.990 / $6.080`). Controles nuevos: 6 opciones de cadena (TODAS + 5), opción `unit-asc`, etiqueta que pasa de `DESDE (TOTTUS)` a `PRECIO (LIDER)`, orden unitario cambiante, toggle bloqueado con carrito vacío, `GRATIS` al superar el umbral y reset restaurando todo. Sin errores JS.

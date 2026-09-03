# Notas del fork NUBIX

Este repo es un fork de OHIF Viewers 3.10 (cornerstone3D). Aquí sólo se documenta lo que es
específico de NUBIX y no se deduce leyendo el código: decisiones, trampas y por qué las cosas
están como están. Para lo demás vale la documentación de OHIF.

Referencia de comportamiento: `../ViewersV2` es el visor anterior, OHIF **2.x legacy**
(`platform/core` 2.16, `cornerstone-core` + `cornerstone-wado-image-loader`). No es una rama del
mismo árbol, así que `diff -r` entre los dos no sirve de nada: son dos motores distintos leyendo el
**mismo manifiesto**, generado por un único sitio en la API
(`routes/v1/organization/methods/utils/ohif.js`, servido desde `.../methods/get.js`).

## Metadatos de píxel: el manifiesto no siempre es de fiar

OHIF 3 registra su `MetadataProvider` con prioridad **9999**
(`extensions/cornerstone/src/init.tsx`), por encima del proveedor propio de
`@cornerstonejs/dicom-image-loader`, que se registra con prioridad 0
(`imageLoader/wadouri/register.js`). Como `imageLoader/getImageFrame.js` construye el frame **desde
el registro de metadatos y no desde el archivo**, todo lo que el manifiesto diga mal sobre los
píxeles acaba en la textura. OHIF 2 no tenía este problema porque construía el frame parseando el
DICOM.

Por eso `platform/core/src/classes/MetadataProvider.ts`, en el caso `IMAGE_PIXEL_MODULE`, devuelve
`undefined` en dos situaciones, para que `metaData.get` siga bajando por prioridad y responda el
proveedor del loader leyendo el dataset ya parseado:

1. **`PALETTE COLOR` sin tabla de color.** El manifiesto nunca ha emitido los tags
   `Red/Green/BluePaletteColorLookupTableData`. Sin ceder el turno, Cornerstone pinta los índices
   crudos como escala de grises: la imagen parece una ecografía normal pero con la curva de tono
   equivocada y las cajas de texto convertidas en bloques blancos.
2. **`PhotometricInterpretation` que no existe en DICOM.** El ingest de la API truncaba el valor
   hasta agosto de 2026 (`YBR_FULL_422` → `'YBR'`, `PALETTE COLOR` → `'PALETTE'`). No hubo backfill,
   así que los estudios anteriores siguen con el valor roto en la base y sólo el archivo sabe cuál
   era.

La condición se mantiene **estrecha a propósito**. `makeVolumeMetadata` de `@cornerstonejs/core`
desestructura este módulo **sin guarda** y puede pedirlo antes de que haya imagen descargada; ceder
de forma general rompería la reconstrucción de volúmenes en CT y MR. Un `MONOCHROME2` bien formado
nunca cede.

Es seguro en el momento que importa: `wadouri/loadImage.js` sólo llama a `createImage` dentro del
`.then` del dataset ya parseado, y el proveedor del loader resuelve con `dataSetCacheManager.get`.
Cuando se pide el módulo para renderizar, el archivo siempre está en caché.

Nota para la API: la rama 2 rescata los estudios viejos sin backfill, así que el ruteo por versión
de `isTypeAcceptable` (documentado en `api/CLAUDE.md`) probablemente ya no haga falta para US.

## Parches a @cornerstonejs/dicom-image-loader

`patches/@cornerstonejs+dicom-image-loader+3.0.4.patch`, aplicado por `patch-package` desde el
`postinstall`. Cuatro arreglos, todos verificados contra archivos reales de producción:

**`isColorConversionRequired.js` — fórmulas 4:2:0 y 4:2:2 intercambiadas.** 4:2:2 submuestrea sólo
en horizontal (2 bytes/píxel); 4:2:0 también en vertical (1.5 bytes/píxel). Estaban cruzadas, así
que un US nativo `YBR_FULL_422` no se convertía nunca y los bytes YBR se subían como RGB: verde.
**El bug sigue vivo en `cornerstone3D/main`**, subir de versión no lo arregla.

**`isColorConversionRequired.js` — `PALETTE COLOR` devolvía siempre `false`.** Como su único
invocador es `createImage.js`, eso dejaba `convertPALETTECOLOR` como código muerto. Ahora devuelve
`true` cuando la tabla está disponible; si falta se mantiene el `false`, porque el converter lanza y
no hay nadie capturando ese error.

**`convertPALETTECOLOR.js` — era asíncrono.** Lanzaba `Promise.all(...).then(...)` y retornaba sin
esperar, mientras `createImage` seguía adelante y calculaba `getMinMax` sobre un buffer vacío. Ahora
es síncrono. La aritmética original se conserva intacta y produce una salida **byte a byte idéntica**
a la referencia calculada con pydicom.

**`createImage.js` — `numberOfComponents` tras convertir.** Se copiaba de `samplesPerPixel`, que en
`PALETTE COLOR` vale 1 por definición DICOM, así que `StackViewport` recibía un solo canal aunque el
buffer ya fuera RGB. Ahora se fija a 3 (o 4 con `useRGBA`) después de `convertColorSpace`.

## Trampa de build: los parches no llegaban al bundle

Dos capas de caché ignoraban `node_modules`, y el síntoma es traicionero: el build **termina bien**,
emite un hash nuevo, y despliega el código **sin parchear**.

- **webpack** trata `node_modules` como inmutable (`snapshot.managedPaths`) y lo instantanea por
  versión, no por contenido. En `.webpack/webpack.base.js` se saca a
  `@cornerstonejs/dicom-image-loader` de esa lista.
- **Nx** cachea por hash de los archivos del proyecto, y ni `node_modules` ni `.webpack/` entraban.
  En `nx.json`, `namedInputs.sharedGlobals` ahora incluye `patches/**` y `.webpack/**`.

Para comprobar que un parche llegó de verdad, mirar el `sourcesContent` del sourcemap:

```bash
cd platform/app/dist && python3 -c "
import json,glob
m=json.load(open(glob.glob('app.bundle.*.js.map')[0]))
for i,s in enumerate(m['sources']):
    if s.endswith('isColorConversionRequired.js'): print(m['sourcesContent'][i])
"
```

## Despliegue

`yarn run deploy:beta` y `yarn run deploy` son un `aws s3 sync` a secas, **sin invalidación de
CloudFront**. Los bundles llevan hash en el nombre y se resuelven solos, pero `index.html` y `sw.js`
no, y la app registra un service worker. Al probar un cambio: recarga forzada o ventana privada
antes de concluir que algo no funcionó.

Para confirmar qué hay arriba:

```bash
curl -sS https://beta-visor.nubix.cloud/index.html | grep -o 'app\.bundle\.[a-f0-9]*\.js'
```

## Score de calcio coronario (`extensions/calcium-score`)

Extensión propia, cargada sólo por el modo longitudinal. No hay nada de Agatston en cornerstone3D;
el motor (`src/utils/agatston.ts`) es nuestro y tiene pruebas jest (`.test.ts`, por eso el
`jest.config.js` de la extensión amplía el `testMatch`).

Decisiones que no se ven en el código:

- **Una segmentación por serie**, con id `calcium-score:<displaySetInstanceUID>`; así el panel la
  reencuentra al cambiar de viewport. Segmentos 1–4 son TCI/DA/Cx/CD; el **5 es "candidatos"**:
  todo lo que pasa de 130 HU, pintado tenue. El clic mueve componentes conexas 3D entre 5 y la
  arteria activa. Las HU se leen del `getPixelData()` de la imagen CT en caché, no del manifiesto.
- Trabaja sobre el **labelmap stack** (una imagen derivada por corte), que es lo que crea
  `createLabelmapForDisplaySet`. En MPR el labelmap se convierte a volumen y la herramienta
  rechaza el clic a propósito: el score se asigna en la vista 2D.
- Los avisos (kVp ≠ 120, incremento ≠ 3 mm, descripción con "angio/contraste") **no bloquean**.
  El manifiesto no trae `ContrastBolusAgent`, así que el contraste sólo se detecta por texto.

Para probarla en local con un manifiesto real hay dos trampas: la API no manda CORS para
`localhost`, y en `http://localhost` la app pide el CDN por `http://`, que CloudFront rechaza con
403. En Playwright: `--disable-web-security` y un `page.route` que reescriba
`http://cdn.nubix.cloud` a `https://`. En producción (https) no pasa.

## CPR de coronarias (`extensions/coronary-cpr`)

Reformateo curvo con `vtkImageCPRMapper` de vtk.js, renderizado en un `vtkGenericRenderWindow`
propio dentro del **panel derecho** (tira vertical), fuera del pipeline de cornerstone. Se eligió
el panel y no el grid porque OHIF elige el componente de un viewport sólo por `SOPClassHandlerId`
y meterlo en el grid exigiría display sets sintéticos.

Decisiones que no se ven en el código:

- **Volumen propio y recortado.** `utils/volumeSampler.ts` lee HU de las imágenes en caché y
  construye un `vtkImageData` Float32 sólo del cubo que envuelve el trazado (± ancho/2 + margen).
  No se reutiliza el volumen de cornerstone porque en este fork puede ser un **sub-rango**
  (`displaySet.volumeSubRange`) y porque el mapper sube el volumen entero a una textura 3D sin
  comprobar `MAX_3D_TEXTURE_SIZE`. Exige WebGL2; sin él, el panel lo dice en texto.
- **Contrato del mapper** (idéntico en vtk.js 32.1.1 y 32.9.0): el actor ocupa x ∈ [0, ancho],
  y ∈ [0, alto] con el **primer punto de la centerline arriba**; sólo lee la primera polyline; la
  orientación va como array `Orientation` de quats por punto; `useStraightenedMode()` /
  `useStretchedMode()` se llaman **después** de `setImageData` y `setCenterlineData`. Hay que
  importar `Rendering/Profiles/Volume` o no se dibuja nada.
- **Geometría propia** (`utils/centerlineGeometry.ts`, con jest): Catmull-Rom centrípeta a 0.5 mm y
  marcos de rotación mínima (doble reflexión). El quat de cada muestra es la matriz con columnas
  (u, v, t): `t` = tangente = `normalDirection` del mapper, `u` = dirección de muestreo. Girar la
  vista = rotar (u, v) alrededor de `t`.
- **El store zustand es la única fuente de verdad** de los puntos; la herramienta
  (`AnnotationDisplayTool`, no `AnnotationTool`) sólo dibuja y edita. No se usa
  `annotation.state` porque `filterAnnotationsForDisplay` sólo mira el primer punto y el plano de
  creación, inútil para una polilínea 3D.
- **Imán al lumen** (`utils/snapToLumen.ts`): centroide de la componente conexa con 150–650 HU en
  un disco de 2.5 mm del plano del viewport; si no hay contraste, se queda el clic.
- **Saltar de corte** en viewports stack va por `csUtils.jumpToSlice`, no por
  `viewport.jumpToWorld`: este último cambia la imagen pero no emite los eventos de scroll que
  actualizan el overlay `I:`.
- Fuera de alcance a propósito: camino mínimo entre dos puntos y detección automática del vaso.

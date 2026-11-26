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

## Supresión del patrón de rejilla (`utils/gridSuppression.ts`)

Algunas radiografías traen las líneas de la rejilla antidifusora grabadas en los píxeles
(Fujifilm DR-ID 330CL, estudio 1124473: líneas verticales cada 2.55 px, 0.38 mm; pico 117 veces
la mediana del espectro). A 1:1 se ve rayado; al reducir, la frecuencia se bate con el muestreo de
pantalla y salen bandas que cambian con el zoom (moiré). No es un bug de render: el visor viejo
también lo mostraba, porque está en el archivo.

- **Dónde:** `initWADOImageLoader.js` vuelve a registrar `dicomweb`/`wadouri`/`dicomfile` con el
  `loadImage` de wadouri envuelto, y filtra el arreglo de píxeles **antes** de que la promesa
  llegue al caché. Así lo ven igual el viewport, las miniaturas y la impresión, y no hay que tocar
  el parche de patch-package. Cargas con `targetBuffer` (volúmenes) no pasan por aquí.
- **Sólo CR y DX, monocromas.** Mamografía queda fuera a propósito: su detalle fino vive en esas
  frecuencias.
- **Detección:** perfil promedio de la mitad central, sin tendencia, espectro de 0.18 a 0.5
  ciclos/px con Goertzel (la DFT directa tardaba >1 s en una placa de 4k; Goertzel ~50 ms); se
  acepta un pico ≥ 25 veces la mediana. En las placas AGFA de 1123677 no detecta nada.
- **Supresión:** muesca adaptativa por demodulación (I/Q a esa frecuencia, paso bajo triangular
  de ~8 periodos, resta), acotada al min/max original. ~170 ms en 2320×2373, una vez por imagen.
- **Visible:** `image.nubixGridSuppression` y la etiqueta gris "Rejilla suprimida" en la esquina
  inferior derecha. Si algo falla, la imagen se muestra tal cual llegó.
- Pruebas jest con fantomas (`gridSuppression.test.js`). Para validar con un archivo real, volcar
  los píxeles con pydicom a `.bin` y cargarlos desde un test temporal.

## Mamografía 2D en espejo (`utils/mammoMirror/`)

Herramienta para mama elegida porque todo radiólogo la usa en **cada** mamografía: comparar una
mama contra la otra (asimetrías). Un localizador de lesiones se descartó como primera herramienta
porque sólo sirve cuando hay hallazgo. El US mamario queda fuera por ahora.

- **Protocolo propio** `@nubix/mammoMirror` (`hpMammoMirror.ts`), registrado en el
  `getHangingProtocolModule` de cornerstone. El modo longitudinal declara
  `hangingProtocol: ['@nubix/mammoMirror', 'default']`: con un arreglo, OHIF elige por reglas en
  vez de forzar `default`. Si el estudio no tiene al menos dos proyecciones reconocidas, nada
  casa y sale `default` como siempre. Etapas: 4 proyecciones (RCC|LCC arriba, RMLO|LMLO abajo),
  par CC y par MLO; se recorren con `.`/`,` o con el control `nubix.mammoStages` de la barra
  (tres botones en escritorio y uno que cicla en teléfono, porque tres desbordaban la barra). Sólo
  aparece con este protocolo activo.
- **No se usa `hpMammo` de OHIF**: identifica las proyecciones por `ViewCodeSequence`,
  `FrameAnatomySequence` o "L CC" en la descripción, y el manifiesto no trae nada de eso. Con la
  mamografía Fuji FDR-3000AWS (estudio 1153278) sólo vienen `ImageLaterality` y
  `PatientOrientation`, y alcanzan. En la MLO las columnas avanzan hacia los pies y hacia un lado
  (`['P','FL']`); en la CC sólo hacia un lado (`['P','L']`). F/H sola es una lateral pura (ML) y no
  entra. Se prefieren `ViewPosition` y `ViewCodeSequence` si algún día llegan.
- **La tomosíntesis no se toca, a propósito por conteo y no por SOP Class** (decisión de
  Arturo): sólo entran series de **una imagen y un frame**. La tomosíntesis, multiframe (la API sí
  emite `NumberOfFrames`) o una instancia por corte, nunca casa y se sigue cargando como antes.
  Una serie con varias proyecciones juntas tampoco entra.
- **Colocación** (`initMammoMirror.ts`, en `VIEWPORT_DATA_CHANGED` y al pulsar Restablecer):
  la **mama encuadrada**, no la imagen completa, con la pared torácica pegada al borde del
  viewport que da al centro de la pantalla. `findTissueBounds` (en `mammoGeometry.ts`) busca el
  tejido en los píxeles de la imagen en caché: el fondo es la mediana de la franja más alejada de
  la pared; el alcance horizontal corta en un hueco del 5 % para no contar las etiquetas "R CC"
  grabadas en el fondo; el vertical sale de una franja pegada a la pared. Las dos mamas del par
  usan el **mismo marco** (`unionFraming`), así quedan a la misma escala sin importar cuál se
  coloque primero. Si no encuentra mama, encuadra la imagen completa. Si el equipo manda la
  imagen al revés, se voltea según `PatientOrientation` (`displayFlips`): pared al centro, axila
  arriba en la MLO, lado externo arriba en la CC.
- **Restablecer:** cornerstone **sólo emite `CAMERA_RESET` en viewports de volumen**, así que en
  los stack el listener nunca corría y la imagen volvía al centro. `resetViewport` y
  `fitViewportToWindow` (`commandsModule.ts`) emiten `nubix-viewport-reset` en el elemento.
- **Cambio de tamaño** (ocultar un panel, girar el teléfono, cambiar de etapa): cornerstone
  conserva el centro y `performResize` de OHIF recalcula zoom y pan respecto de la imagen
  completa, así que el encuadre se perdía. Se detecta por un `CAMERA_MODIFIED` con el canvas de
  otro tamaño y, en un `setTimeout(0)` (cuando OHIF ya terminó, es síncrono): si la cámara sigue
  como se colocó, se encuadra de nuevo; si el usuario ya movió algo, se restaura su cámara con la
  misma escala en mm por píxel y con el punto que estaba en el borde interior de vuelta al borde.
- **Espejo** (sincronizador `nubixmammomirror`, uno para CC y otro para MLO): mapea el centro de
  la vista por coordenadas anatómicas, mm desde la pared torácica y mm desde el centro vertical,
  con la misma escala en mm por píxel de pantalla. No sirve el `zoompan` de cornerstone porque
  copia el desplazamiento tal cual, y aquí el horizontal va invertido. Si el usuario arrastra una
  serie del mismo lado a uno de los viewports, el espejo no actúa. La geometría vive aparte y
  probada con jest (`mammoGeometry.ts` + `.test.js`).
- Verificado en local con 1153278 a 1440×900, 2560×1440 y 390×844: acercar ×3 la RCC en la
  columna 3700 (1028 px de la pared) deja la LCC en la columna 1028, misma fila y escala; las
  MLO no se mueven. El US 1153339 sigue abriendo con `default`.
- **Zoom desde el fondo:** `ZoomTouchTool` (la herramienta Zoom de la app) tenía
  `minZoomScale: 0.1` (píxeles de pantalla por píxel de imagen). Una mamografía de 5928 filas a
  0.05 mm ajustada a la pantalla ya queda en ~0.08, así que el primer paso de zoom se recortaba
  al mínimo **sin mover el centro** y se acercaba al fondo negro en vez de al dedo. Ahora 0.01.
- **Restablecer dejaba la imagen en negativo** en toda imagen MONOCHROME1 (también CR): cornerstone
  guarda los nodos de la curva de color antes de invertir y `resetProperties` los restaura
  conservando `invert = true`. `resetViewport` rehace la curva con
  `setVOI(..., { forceRecreateLUTFunction: true })` cuando la imagen está invertida.
- **Trampa de prueba:** el Chrome de Playwright sin GPU no crea contexto WebGL, la ruta se
  reinicia y parece que el visor está roto. Lanzar con `--enable-unsafe-swiftshader
  --use-angle=swiftshader`.
- Pendiente: el manifiesto no trae `SeriesDescription` en estas mamografías, así que las
  miniaturas salen sin etiqueta (lo arregla la API, el archivo trae "MAMOGRAFIA DCHA, CC"). El
  previo no viene en el mismo manifiesto, así que no hay comparación con estudio anterior. En
  teléfono el texto del overlay se encima en los viewports angostos del 2×2 (visto, no
  investigado).

## Parches a @cornerstonejs/dicom-image-loader

`patches/@cornerstonejs+dicom-image-loader+3.0.4.patch`, aplicado por `patch-package` desde el
`postinstall`. Cinco arreglos, todos verificados contra archivos reales de producción:

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

**`createImage.js` — ventana derivada de la VOI LUT Sequence.** Los CR de AGFA (CR30-Xm, estudio
1123677) no traen `WindowCenter/Width`: traen una **VOI LUT Sequence** (tabla de ~8400 entradas,
`PresentationLUTShape INVERSE`, `MONOCHROME1`). El loader sí la lee (`image.voiLUT`), pero el render
GPU de cornerstone3D sólo aplica la LUT en el fallback CPU y con la ventana ausente cae a mín/máx de
píxel: W 27123 / L 13631, la placa gris lavada que la organización describió como "muy blanca". El
visor OHIF 2 aplicaba la tabla. El parche, antes del fallback a mín/máx, aproxima la LUT con la
ventana lineal que pasa por sus cruces de 5 % y 95 % (`windowFromVoiLUT`): en esa placa da W 6801 /
L 16512 y la imagen queda igual que con la LUT exacta (la curva es casi lineal entre esos puntos,
sólo redondea las puntas). Se prefirió esto a aplicar la LUT sobre los píxeles porque conserva los
valores originales y deja funcionar la herramienta de ventana con normalidad. Referencia: renderizar
con pydicom `LUTData[clip(p − first, 0, n−1)]` e invertir.

## Parche a jpeg-lossless-decoder-js: el último píxel salía en 0

`patches/jpeg-lossless-decoder-js+2.1.2.patch` (2.1.2 es la última versión publicada; el bug sigue
ahí). El decodificador lee el siguiente byte por adelantado y, si es el `FF` del EOI, marca
`markerIndex = 9`; después descarta cualquier código Huffman que deje menos de 9 bits en el
registro, aunque el código haya terminado justo antes del marcador. Upstream ya exime al último
píxel con `isLastPixel()` en `getn` (bits de magnitud), pero no en `getHuffmanValue`. Cuando el
último píxel tiene diferencia 0 con su vecino (categoría SSSS = 0, sin bits extra: aire junto a
aire, lo normal en la esquina), la rutina devuelve el marcador, el bucle de `decode` sale sin
llamar a `output` y ese píxel se queda en el 0 del buffer recién creado.

Un píxel no se ve, pero sin `WindowCenter/Width` cornerstone ventana por **mín/máx del corte**, y
el mínimo pasa de ~31600 a 0. Ticket de Enrique Eickmeier (CBCT dental Dürr VistaSoft, píxeles =
HU + 32768 sin `RescaleIntercept`, sin ventana; estudios 1159197 y 1170848): en 1159197 el corte
central (el que usa `setDefaultVolumeVOI` para el MPR) estaba afectado y todo salía gris
blanquecino con W 38398 / L 19199; en el stack, uno de cada ~8 cortes parpadeaba igual. Medido
con el decodificador en node contra pydicom: 48/425 y 56/425 cortes con el último píxel mal, y
3/61 CT/MR de `test-files` recomprimidos con `gdcmconv -J`, o sea que **no es cosa del equipo**:
afecta a cualquier JPEG Lossless (`1.2.840.10008.1.2.4.70`/`.57`). Con el parche: 0 diferencias en
los 911 cortes.

## Trampa de build: los parches no llegaban al bundle

Dos capas de caché ignoraban `node_modules`, y el síntoma es traicionero: el build **termina bien**,
emite un hash nuevo, y despliega el código **sin parchear**.

- **webpack** trata `node_modules` como inmutable (`snapshot.managedPaths`) y lo instantanea por
  versión, no por contenido. En `.webpack/webpack.base.js` se sacan de esa lista los paquetes
  parcheados (`@cornerstonejs/dicom-image-loader`, `jpeg-lossless-decoder-js`); **un parche
  nuevo exige añadir su paquete ahí**.
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

Si ese hash no coincide con el de `platform/app/dist`, CloudFront está sirviendo un `index.html`
viejo (`curl -sI` muestra `x-cache: Hit from cloudfront` con `age` de horas); la recarga forzada no
lo arregla porque la copia vieja está en el borde, no en el navegador. Se invalida así (la
distribución de beta es `E20ODCS5XAHVIH`):

```bash
aws cloudfront create-invalidation --distribution-id E20ODCS5XAHVIH --paths "/index.html" "/sw.js" "/manifest.json"
```

## PDF encapsulado (DOC)

La extensión `dicom-pdf` de OHIF ya reconoce `1.2.840.10008.5.1.4.1.1.104.1` y el modo longitudinal
la carga, pero su `pdfUrl` pide a la fuente de datos el bulkdata de `EncapsulatedDocument`, que sólo
existe en DICOMweb. Con el manifiesto JSON (archivos completos en CloudFront) eso devolvía una URL
sin sentido y el viewport quedaba vacío. `DicomJSONDataSource.retrieve.directURL` lo intercepta:
descarga el archivo, lo parsea con `dicom-parser`, extrae `(0042,0011)` (quitando el byte nulo de
relleno par de OB) y devuelve una URL de Blob cacheada por instancia
(`DicomJSONDataSource/getEncapsulatedDocumentURL.js`). Probado con
`test-files/tst/tst-pdf-mri/bbmri-pdf.dcm` (MR + DOC en el mismo estudio) sirviéndolo con un
manifiesto local. La miniatura es un **icono SVG en data URL** con la etiqueta del formato
(`getDocumentThumbnailURL`); los dos navegadores de estudios (`PanelStudyBrowser` y
`PanelStudyBrowserTracking`) muestran como tarjeta cualquier display set "sin imagen" que traiga
`thumbnailSrc`, en vez de la fila de texto. En **iOS** (y en navegadores sin visor integrado,
`navigator.pdfViewerEnabled === false`) el `<object>` pinta la primera página minúscula, así que
ahí el viewport pagina el documento con **pdf.js** (`dicom-pdf/src/viewports/PdfPages.tsx`: un
canvas por página, ancho del viewport, zoom por pasos, enlace "Abrir" por si acaso). En escritorio
se conserva el visor nativo del navegador, que trae búsqueda e impresión. `pdfjs-dist` se importa
de forma diferida (chunk aparte) y su worker se copia a la raíz del `dist` como
`pdf.worker.min.mjs` desde `webpack.pwa.js`; si falta, pdf.js no abre nada. Al añadir la
dependencia no usar `yarn add`: reescribe medio `yarn.lock` y sube `prettier-plugin-tailwindcss` a
una versión ESM que rompe prettier; se añade la línea a `platform/app/package.json` y se corre
`yarn install`. Lo que la API haga con estudios de tipo `DOC` es otra conversación.

## Localizador dentro de la serie y MPR (`utils/splitLocalizers.js`)

Muchos CT mandan el scout/topograma **dentro de la misma serie** que los axiales (estudio 1153591,
AlphaCT 328 Plus: 120 axiales de 512² más un coronal de 533×742 con `InstanceNumber` 0; el
`ImageType` no lo distingue). `isDisplaySetReconstructable` exige misma orientación y tamaño en
todas las imágenes, así que esa sola imagen dejaba la serie entera sin MPR.

- **Decisión de Arturo: no crear una serie aparte.** Se probó separar el localizador en su propio
  display set y lo descartó; la serie sigue siendo una sola y el localizador sigue en el stack
  (contador 1/121), pero el volumen se arma sin él.
- `splitLocalizers` agrupa por filas × columnas × orientación (tolerancia 0.01, la misma de
  OHIF) y sólo aparta las imágenes distintas si son pocas (≤ 3 o ≤ 10 %) frente a un grupo
  principal de ≥ 3. `getSopClassHandlerModule` además exige que el grupo principal **sea
  reconstruible**; si no, la serie queda exactamente como antes (un US con tamaños mezclados no se
  toca).
- El display set lleva `localizerSOPInstanceUIDs`; `CornerstoneCacheService` filtra esos
  imageIds (por `SOPInstanceUID` vía `metaData.get('instance')`) antes del sub-rango de textura.
  `displaySet.imageIds` sigue siendo la serie completa. `isReconstructable`,
  `averageSpacingBetweenFrames` y los mensajes se calculan sobre el grupo principal, y
  `displaySet.instance` (de donde lee el overlay posición, FoV y grosor) apunta a un corte, no al
  localizador.
- Verificado en local con 1153591: las cuatro fases abren en MPR con volumen 512×512×120.

## MPR a medias en series largas: la cola de prefetch es compartida

Ticket del estudio 1186425 (CBCT NewTom, 606 cortes de 546×547): las series de 40 cortes abrían en
MPR y la de 606 se quedaba gris, a medias, para siempre. No era el equipo ni el archivo.

- `imageLoadPoolManager` tiene **una sola cola `Prefetch`** y ahí esperan tres cosas: el prefetch
  del stack (`stackContextPrefetch`), el de estudio (`StudyPrefetcherService`, que upstream trae
  apagado y aquí está encendido en `default.js`) y los cortes del volumen MPR (`nthLoader`,
  `interleaveCenterLoader`, `interleaveTopToBottom`).
- `StudyPrefetcherService._stopPrefetching` hacía `clearRequestStack(Prefetch)` en cada reinicio
  (cambia la serie del viewport activo, `DISPLAY_SETS_CHANGED`), y con eso tiraba los cortes del
  volumen. Como el volumen se queda con `loadStatus.loading = true`,
  `CornerstoneViewportService` no vuelve a llamar a `volume.load()` y nadie los pide otra vez.
  Ahora vacía la cola con `filterRequests` **dejando sólo los cortes de volumen**
  (`additionalDetails.volumeId`). Lo demás se sigue descartando a propósito, igual que antes: una
  primera versión retiraba sólo las peticiones del propio servicio y dejaba vivo el prefetch del
  stack que se acababa de cerrar (~500 peticiones por delante de la serie nueva), que en conexión
  lenta retrasaría la precarga al saltar entre series.
- Depende del orden de los clics y del tamaño: 40 cortes terminan antes del reinicio. Entrar
  directo a MPR sobre la serie larga solía funcionar; abrir otra serie antes, no.
- Los tres cargadores de volumen encolan con **prioridad −1** (número menor = antes). Con 0
  quedaban detrás del prefetch del stack recién cerrado y el MPR no pintaba un solo corte hasta
  que esas peticiones viejas terminaban.
- Para ver la cola en un build de producción sin tocar código: `self.webpackChunk.push([[Symbol()],
  {}, r => (req = r)])` y buscar en `req.m` el módulo cuyo fuente contiene `'imageLoadPool'`.
- Visto y no investigado: con una serie ATM en el stack, `toggleHangingProtocol {protocolId:'mpr'}`
  lanzado por comando abrió la serie de 606 y no la ATM.

### Pantalla en blanco en un equipo Windows (sin resolver)

El mismo ticket traía capturas que **no** son el atasco de arriba: los tres planos en blanco, con
el icono de imagen rota de Chrome en la esquina de cada canvas, y el aviso "Something went wrong".
Hipótesis sin confirmar: la GPU de ese equipo no sostiene la textura 3D de 546×547×606 (~345 MB
con 16 bits normalizados, el doble si sube como float32) y el navegador le quita el contexto a
todos los canvas. No se pudo reproducir: una pérdida simulada con `WEBGL_lose_context` congela la
imagen, no la pone blanca. Lo que se dejó para la próxima vez:

- **`ErrorBoundary` (ui-next) ya muestra el detalle en producción.** Upstream devolvía `null`, así
  que "Show Details" era un botón muerto y los reportes llegaban sin el texto del error. El detalle
  trae mensaje, traza, URL, navegador y los datos de GPU. De paso se quitó el "false" que se colaba
  en el título (`!isProduction && ...` dentro de una plantilla).
- **`probeGpu`** (`platform/app/src/utils`) mide una vez al arrancar, en el mismo contexto que ya
  se creaba para `max3DTextureSize`, y deja `window.nubixGpuInfo` (modelo, límites de textura,
  `norm16`, `deviceMemory`). No hay API para saber la memoria de video.
- **`watchWebGLContextLoss`** (extensión de cornerstone, enganchado al crear el `RenderingEngine`)
  escucha `webglcontextlost` en el canvas offscreen, avisa con las reconstrucciones que había
  cargadas y deja `window.nubixContextLoss`. No intenta recuperarse: cornerstone no rehace sus
  texturas, hay que recargar. Trampa: en `uiNotificationService.show`, `duration: 0` no es "para
  siempre" (sonner aplica su duración por defecto); para un aviso fijo va `Infinity`.
- **Lo que sí se supo (25-nov-2026):** con el detalle ya activo, ese equipo mandó `TypeError:
  Cannot read properties of undefined (reading 'values')` en `RenderingEngine._getViewportsAsArray`,
  sobre una pantalla vacía. Es el síntoma de **un navegador sin WebGL** (reproducido igual con
  `--disable-gpu --disable-3d-apis`): el constructor de `RenderingEngine` se registra en el caché y
  truena al crear la ventana offscreen, antes de inicializar `_viewports`; todo lo que venga
  después usa ese motor a medio construir. Chrome bloquea WebGL cuando la tarjeta gráfica falla
  varias veces, así que cuadra con la hipótesis, pero no la prueba.
- **No se activó el respaldo por CPU, por decisión de Arturo** (no arriesgar a los demás por
  arreglar un equipo). El origen es `init.tsx`: `cornerstone.setUseCPURendering(Boolean(
  appConfig.useCPURendering))` pisa con `false` lo que cornerstone ya detectó en su `init`. Se probó
  respetar esa detección: el stack sí pinta por CPU, pero el MPR queda en negro sin aviso y
  `uiNotificationService.show` llamado desde el `init` de la extensión no muestra nada (el
  proveedor aún no existe). Si se retoma, hay que resolver esas dos cosas.
- **Confirmado en ese equipo (25-nov-2026):** con beta, al entrar al MPR de la serie de 606 salió
  el aviso de `watchWebGLContextLoss`. La GPU sí pierde el contexto con ese volumen; falta saber
  si es por memoria o porque el controlador tarda y Windows lo reinicia (no llegó el
  `nubixGpuInfo`).
- **Tras la caída se ofrece reconstruir menos cortes, a elección del usuario.** Es un diálogo
  (`components/GpuLostDialog.tsx`, por `uiModalService`) con "Reconstruir N cortes" y "Recargar
  completa". Baja **de dos tercios en dos tercios** (decisión de Arturo: 100 → 66 → 44 → 30 % de
  la serie, no a la mitad); por debajo de 20 cortes ya no se ofrece. El tope va a `sessionStorage`
  (`nubix.maxVolumeSlices`) porque la página tiene que recargarse: es de **esa pestaña en ese
  equipo**, no del estudio, y muere al cerrarla; "Recargar completa" lo quita. `getMaxVolumeSlices`
  devuelve el menor entre ese tope y `MAX_3D_TEXTURE_SIZE`, así que lo demás es el sub-rango a
  resolución nativa de siempre, con su aviso y su etiqueta ámbar "Parcial: cortes a–b de n".
  Confirmado en el equipo Windows del ticket: con 303 de 606 cortes sí reconstruye.
- **Por qué diálogo y no toast:** la primera versión era un `toast.error` de sonner con dos
  botones; con el texto largo se plegaba en una columna roja angosta, ilegible, encima de los
  overlays. La imagen ya no responde, así que tapar el fondo no cuesta nada. No se cierra con Esc
  ni con clic fuera.
- **Falla sin evento (26-nov-2026, hipótesis):** en ese equipo, tras elegir 404 de 606 cortes, el
  MPR quedó sin mostrar nada y **sin aviso**: el contexto no se perdió, así que no había forma de
  pedir menos cortes (con 303 sí había funcionado). Lo más probable es que la reserva de la
  textura falle con `GL_OUT_OF_MEMORY`, que vtk no revisa. `scheduleGpuHealthCheck` (mismo
  archivo, llamado desde `_setVolumeViewport`) pregunta `gl.getError()` a 1.5, 6 y 15 s de
  asignar un volumen y, si hay `OUT_OF_MEMORY` o el contexto está perdido, abre el mismo diálogo.
  Los errores vistos quedan en `nubixGpuInfo.glErrors`. En un MPR normal no reporta ninguno;
  probado sólo inyectando el error. **Falta confirmar en ese equipo que ésa es la falla.**
- **No se puso un presupuesto de memoria preventivo** a propósito: el navegador no expone la
  memoria de video y sin datos el umbral sería inventado; la única señal fiable es la caída misma.
  `preferSizeOverAccuracy` queda descartado: con media precisión los enteros sólo son exactos
  hasta 2048 y un CT se sale.

## Proyección de grosor: MIP, MinIP y promedio (`utils/slabProjection.ts`)

Cornerstone ya pinta MIP/MinIP/promedio en los `VolumeViewport` ortográficos (`setBlendMode` +
`setSlabThickness`) y `CornerstoneViewportService` los acepta desde un protocolo, pero el modo
longitudinal no los exponía. Ahora hay:

- **Barra:** componente propio `nubix.slabProjection` (`components/ToolbarSlabProjection.tsx`,
  registrado en `getToolbarModule.tsx`) que **devuelve null si el viewport activo no es un plano
  MPR**: Arturo pidió que no aparezca fuera del MPR, y un evaluador sólo puede deshabilitar, no
  ocultar. Se redibuja con `VIEWPORT_DATA_CHANGED`, `PROTOCOL_CHANGED` y el evento de slab. Al
  pulsarlo abre un Popover con modo, deslizador de 1–50 mm y atajos de 5/10/20/30 mm; ese
  contenido (`WindowLevelActionMenu/SlabProjection.tsx`) es el mismo del submenú "Proyección
  (MIP)" del menú de cada viewport. El grosor en un submenú escondido no se encontraba: por eso
  el panel de la barra lo lleva a la vista. Grosor inicial 10 mm; al cambiar de modo se conserva.
- El comando `setSlabProjection` actúa sobre el plano indicado (o el activo) y no hace nada fuera
  de un volumen.
- **Sólo el actor de la imagen** (`getDefaultActor`) recibe el modo y el grosor: una MIP de un
  labelmap o de una fusión taparía la anatomía.
- **Sin estado propio:** modo y grosor se leen del viewport (`getBlendMode`/`getSlabThickness`);
  al cambiar de protocolo los viewports se recrean y vuelven a corte fino.
- **Etiqueta ámbar en la esquina** ("MIP 10 mm", ítem `SlabProjection` de
  `viewportOverlay.bottomRight`) para que una proyección nunca se lea como corte. Dos trampas: la
  `condition` de un ítem del overlay **no recibe `servicesManager`**, sólo `viewportId` y datos del
  display set (por eso se usa `getEnabledElementByViewportId`); y el overlay sólo se redibuja con
  scroll, zoom o ventana, así que `applySlab` emite `nubix-slab-modified` en el elemento y
  `CustomizableViewportOverlay` lo escucha.

## Coxometría y gonometría (`extensions/cornerstone/src/tools`)

Dos herramientas de medición con el patrón del índice cardiotorácico: subclase de una herramienta
de cornerstone que reutiliza su interacción, mapeo propio al panel de Mediciones y registro en los
mismos sitios (`initCornerstoneTools.js`, `initMeasurementService.ts`,
`measurementServiceMappingsFactory.ts`, `supportedTools.js`, `measurementsCustomization.ts`, y en
el modo `toolbarButtons.ts`, la sección de medición de `index.ts` e `initToolGroups.js`). Se pidió
"la más usada" de cada una, no un conjunto completo:

- **Coxometría = índice acetabular bilateral** (`AcetabularIndexTool`, sobre `CobbAngleTool`). Es
  lo que se pide en el tamiz de displasia de cadera. Segmento 1 = Hilgenreiner (Y a Y); segmento 2
  = borde lateral a borde lateral, que **no se dibuja**: se trazan en su lugar los techos y las
  líneas de Perkins. Por eso `isPointNearTool` sólo mira Hilgenreiner (si no, clicar entre las
  cabezas femorales seleccionaba una línea invisible). Cada borde se asigna a su Y por la pareja
  de menor distancia, así el orden de los clics no importa.
- **Gonometría = eje mecánico HKA** (`MechanicalAxisTool`, sobre `AngleTool`): cadera, rodilla
  (vértice), tobillo. `AngleTool` asigna `renderAnnotation` en su constructor, así que se envuelve
  ahí para añadir la línea de Mikulicz; `cachedStats` conserva `angle` porque el dibujo base lo lee.
- **Lados y medial** se deciden en índice de imagen (no cambian al voltear el viewport). Derecha o
  izquierda sale de `PatientOrientation` (componente de las columnas; sin ella se asume la
  convención AP, derecha del paciente a la izquierda de la imagen). **Medial = hacia la mitad de la
  imagen**, válido en la telerradiografía bilateral; si la cadera cae en la franja central del 5 %
  (placa de un solo miembro) no se dice varo ni valgo y el texto lo avisa. Varo = rodilla por fuera
  de la línea cadera-tobillo.
- La geometría vive aparte y probada con jest (`utils/orthoGeometry.ts` + `.test.js`; la extensión
  sólo corre `*.test.js`).
- **Trampa:** `utils.roundNumber(x, 1)` de `@ohif/core` lanza "toFixed() digits argument must be
  between 0 and 100" con ángulos de dos cifras, y como lo llama el mapeo, la medición llega vacía
  al panel sin error visible (sólo un `console.error` de MeasurementService). Los mapeos nuevos
  usan `toFixed(1)` directo.

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
- **Mediciones sobre la tira** (`utils/measurements.ts`, con jest): regla y estenosis (referencia +
  mínimo → %). Se guardan en **coordenadas mundo** y se proyectan a la tira en cada render
  (`projectToStrip`: muestra más cercana + descomposición en u/v), así siguen a la anatomía al
  girar o cambiar el ancho y se atenúan si quedan fuera del plano. Las longitudes son 3D reales.
  Las distancias para proyectar se piden al mapper (`getOrientedCenterline().getDistancesToFirstPoint()`)
  para respetar la métrica del modo (recto/estirado). Una medición por activación de la
  herramienta; al completarla el clic vuelve a "saltar al corte".
- Fuera de alcance a propósito: camino mínimo entre dos puntos, detección automática del vaso y
  vista transversal perpendicular al vaso (sería el siguiente paso natural para ROIs con HU).

## Dental: panorámica, cortes y canal (`extensions/dental`)

Herramientas para CBCT dental, elegidas por paridad con OnDemand3D: arco trazado en el axial →
panorámica reconstruida + cortes transversales, canal mandibular y regla. Botón del diente
(`DentalArch`, mismo patrón que el CPR: el id del botón es el nombre de la herramienta) y panel
propio. **Los implantes quedan fuera por decisión de Arturo** (ni biblioteca ni cilindro genérico);
tampoco hay ATM, fusión ni cefalometría.

Decisiones que no se ven en el código:

- **No usa `vtkImageCPRMapper` ni WebGL.** La panorámica y los cortes son superficies paralelas a
  la normal de los cortes, así que cada columna de la imagen es un rayo vertical con (fila,
  columna) fijas: los pesos bilineales se calculan una vez por rayo y se reutilizan en todos los
  cortes (`utils/reslice.ts`, `sampleColumns`). En CPU la panorámica del fantoma (254 × 120, 21
  rayos de grosor) tarda menos de 10 ms; con un CBCT real no está medido. Se dibuja en un lienzo
  2D (se captura sin trucos para el PDF) y funciona sin WebGL2. Por eso tampoco comparte código
  con `coronary-cpr`.
- **La franja va bajo la rejilla, no en el panel**: una panorámica en 280 px no sirve.
  `ViewerLayout` pinta la customization `viewerLayout.bottomDock` debajo de la rejilla de
  viewports; la extensión la registra en su `getCustomizationModule` (`default`) y el componente
  devuelve null mientras la herramienta no esté iniciada. Es el primer uso de ese hueco. El panel
  derecho sólo lleva los controles.
- **Rejilla propia** (`utils/volumeGrid.ts`), leída de las imágenes en caché y sin el localizador
  (`localizerSOPInstanceUIDs`). Guarda la referencia al arreglo de píxeles de cada corte, así que
  sobrevive si cornerstone desaloja la imagen; `onModeExit` de la extensión la suelta. **Lanza si
  la separación entre cortes no es uniforme** (±10 %): reconstruir sobre un espaciado supuesto
  daría una imagen normal con medidas falsas.
- **El arco siempre empieza en la derecha del paciente** (x menor en LPS), se trace en el sentido
  que se trace: la panorámica sale en convención radiográfica y lleva R/L. La normal apunta a
  vestibular (lado opuesto al centroide) y en los cortes **vestibular va a la izquierda**.
- **Coordenadas de arco** (s = mm sobre el arco, o = mm a vestibular, c = mm por la normal):
  canal y reglas se guardan en mundo y se proyectan al arco en cada dibujo, así siguen a la
  anatomía si el arco se corrige. La geometría vive en `utils/archGeometry.ts`, con jest.
- **El canal se marca en los cortes transversales, no en la panorámica**: un clic sobre la
  panorámica con grosor no sabe a qué profundidad vestíbulo-lingual cae, y la distancia al canal
  es lo que importa. En la panorámica y en el axial sólo se dibuja. El anillo de los cortes es una
  marca (1.25 mm de radio), no el diámetro del canal.
- **Reglas:** en un corte, distancia real en 3D; en la panorámica, **sobre la superficie curva**
  (avance por el arco y altura), que es lo que se ve; el panel y la hoja lo dicen. Una regla
  necesita sus dos puntos en la misma vista y el mismo corte. Los cortes van en
  `cursor + m × separación`, y un punto o regla pertenece a un corte si dista ≤ 0.25 mm sobre el
  arco: la rueda conserva esa retícula, un clic en la panorámica la cambia.
- **Ventana automática por percentiles** (2 %–99.8 %), no la del viewport: los CBCT Dürr mandan
  HU + 32768 sin ventana y el promedio del grosor cambia el rango. La de los cortes sale del corte
  del centro del arco para que el contraste no cambie al avanzar. **No se informa densidad ósea**:
  los grises de un CBCT no son HU fiables.
- **Hoja a tamaño real:** `buildReportDocument` tiene el bloque `scaled` (imágenes en mm sobre el
  papel). Sólo es 1:1 si el navegador imprime al 100 %; por eso cada imagen lleva una barra de
  10 mm. Si la panorámica no cabe en vertical la hoja sale apaisada, y si ni así, reducida y lo
  dice.
- En teléfono `dentalActivate` no abre el panel (dejaría la imagen en una rendija justo donde se
  traza el arco); la franja muestra el avance de la carga. `DentalArchTool` define
  `preTouchStartCallback`/`touchDragCallback`: cornerstone no llama a `preMouseDownCallback` con
  el dedo (visto en `touchStart.js`; el CPR no los define, así que su trazado probablemente no
  responde al tacto: no se probó).
- Probado en local con un **fantoma sintético** (mandíbula en U, dientes, canal y dos marcas a
  20 mm; generado con dcmjs y servido con un manifiesto local): regla entre las marcas 20.0 mm,
  40.0 mm sobre la panorámica, salto al corte axial correcto, MPR y 390×844. **Falta probarlo con
  un CBCT real** (1159197 y 1170848, Dürr) y la validación de un odontólogo o radiólogo.

## Exportar a PDF y no persistir

Arturo no quiere estado persistente por estudio (ni API ni `localStorage`): lo trabajado se
exporta como **hoja de impresión** (`utils.printSheet.buildReportDocument` en
`extensions/cornerstone/src/utils/printSheet/`, abierta con `openPrintSheet`; el usuario guarda
PDF desde el diálogo del navegador). Trampa: la tira CPR es un canvas WebGL con
`preserveDrawingBuffer:false`, así que `html2canvas` la saca en negro; `CprView` expone
`captureStrip()` que usa `captureNextImage` de vtk.js justo tras un render y compone encima el
SVG de mediciones. La gráfica de curvas (SVG) se rasteriza con `rasterizeSvg`. "Ver en 3D" del
score sólo aplica el protocolo `only3D` y añade la segmentación al viewport: polySeg la convierte a
superficie sin código propio.

## Disposición en teléfono (≤ 768 px)

El umbral es `window.innerWidth <= 768` y se repite en cuatro sitios que deben moverse juntos:
`modes/longitudinal/src/index.ts` (barra de herramientas y `layoutTemplate`),
`ViewerLayout/index.tsx`, `ViewerLayout/constants/panels.ts` y
`PanelStudyBrowserTracking.tsx`. También lo usan `dentalActivate` (`extensions/dental`) y, con 640 px
de ancho de la propia franja, `layoutDock`.

En teléfono la disposición se **voltea completa**: el navegador de series pasa al riel derecho,
donde alcanza el pulgar, y los paneles de trabajo (mediciones, segmentación, score, CPR, curvas)
al izquierdo. Se voltea en bloque y no sólo el navegador porque juntar las seis pestañas en un
mismo riel de 280 px las parte en dos filas de iconos de 40 px.

- **El riel de series mide 160 px en móvil** (`panels.ts`). Las miniaturas son de 135 px, así que
  a 280 px la rejilla acomoda dos columnas y el panel abierto se come tres cuartas partes de la
  pantalla; a 160 cabe una columna y la imagen conserva más de la mitad. Eso también hace cómodo
  el toque sobre la imagen que cierra los paneles: si la imagen mide 110 px, el blanco al que hay
  que atinar es diminuto y el mismo toque inicia un desplazamiento.
- **El panel se abre solo si hay más de una serie**, y eso vive en `onModeEnter` del modo, no en
  el panel: **`SidePanel` no monta el contenido de la pestaña mientras el riel está contraído**, así
  que un efecto dentro de `PanelStudyBrowserTracking` nunca correría (se intentó; no abría nada).
  El que sí está montado y escuchando `ACTIVATE_PANEL` es `SidePanelWithServices`. El modo se
  suscribe a `DISPLAY_SETS_ADDED` y pide `panelService.activatePanel(id, true)` mientras haya más
  de un display set; pedirlo en cada lote es inofensivo porque `SidePanelWithServices` respeta
  `closedManually`. Con una sola serie —la mayoría en teléfono— el panel se queda contraído.
- **Un toque en la miniatura no es siempre una elección.** `Thumbnail` abre la serie con un solo
  toque (sin doble toque), y por eso mide el desplazamiento entre `touchstart` y `touchend`: sin
  ese filtro, recorrer la lista de miniaturas abría la serie donde quedara el dedo y —con el
  cierre automático— cerraba el panel a media pasada. Umbrales: 10 px y 600 ms.
- **Elegir una serie cierra el panel** (`panelService.closePanel`, añadido en `PanelService`): el
  panel no sabe de qué lado lo puso el modo, así que el servicio resuelve la posición y emite la
  opción `leftPanelClosed`/`rightPanelClosed` que `ViewerLayout` ya escuchaba en `PANELS_CHANGED`.
  El componente se ubica a sí mismo buscando su módulo por nombre (`seriesList`) entre los dos
  rieles; por eso funciona igual volteado.
- **La tira contraída se abre tocándola en cualquier punto**: el `onClick` está en el contenedor
  de `SidePanel`, la flecha es sólo el indicador. Por eso el grupo (flecha, iconos y etiqueta
  vertical) va **centrado** y no pegado arriba, que hacía pensar que sólo respondía ahí; en
  teléfono, además, el medio es lo que alcanza el pulgar. Abierta, el contenido sigue desde arriba.
- **Pellizco con dos dedos** (`tools/PinchZoomTool.ts`, herramienta `PinchZoom`): hasta
  2026-10-25 ningún gesto de dos dedos tenía herramienta y el pellizco no hacía nada (el manual
  ya lo prometía). Es una herramienta aparte de `Zoom` (que usa el arrastre de un dedo cuando se
  elige en la barra) atada a `numTouchPoints: 2` en los cuatro grupos de `initToolGroups.js`.
  Cornerstone elige la herramienta en cada movimiento según cuántos dedos hay, así que el dedo
  único sigue siendo de la herramienta activa; al pasar de uno a dos dedos reporta distancia cero
  en ese cuadro, sin salto. Como no tiene binding `Primary`, `setToolActive` de la barra no la
  vuelve pasiva. Probado con CDP `Input.dispatchTouchEvent` a 390×844.
- **Safari en iPhone hace zoom a la página** con el pellizco aunque el viewport meta diga
  `user-scalable=no`, y cornerstone no llama a `preventDefault` ni pone `touch-action`.
  `utils/preventBrowserPinch.ts` (desde `elementEnabledHandler` de `init.tsx`) pone
  `touch-action: none` en el elemento del viewport y cancela `touchmove` con dos dedos y los
  `gesturestart`/`gesturechange` de Safari. Sólo sobre la imagen; los paneles no cambian. El
  Chrome emulado de Playwright respeta `user-scalable=no`, así que esto sólo se ve en un iPhone.
- **El tour guiado sólo existe en escritorio** (`onboardingCustomization.ts`). En teléfono las
  miniaturas ya están a la vista cuando hay algo que elegir, así que el paso sólo interpondría un
  velo modal sobre la primera interacción. En escritorio apunta a `[data-cy="seriesList-btn"]`,
  que es el botón del propio panel —existe abierto (la etiqueta "Estudios") y colapsado (el icono
  del riel)— y no al encabezado de un lado concreto.

## Etiqueta beta

Las herramientas clínicas (score de calcio, CPR, curvas cinéticas, dental) se muestran como **beta**
mientras no se validen contra una estación de trabajo: sufijo "· beta" en el botón
(`modes/longitudinal/src/toolbarButtons.ts`), aviso en la primera línea de cada panel y en los CSV,
y recuadro en el manual. Todo sale de `IS_BETA` / `BETA_NOTICE` en el `constants.ts` de cada
extensión; quitar el beta = ponerlo en `false`, quitar el sufijo del botón y regenerar el manual.

## Curvas cinéticas de mama (`extensions/breast-kinetics`)

Curvas tiempo-intensidad para resonancia dinámica. Mismo patrón que las herramientas cardíacas:
extensión propia, panel derecho, herramienta `AnnotationDisplayTool` sobre un store zustand.

Decisiones que no se ven en el código:

- **Las fases se detectan por geometría**, no por tags temporales: el manifiesto no emite
  `TriggerTime` ni `TemporalPositionIdentifier`, así que `isDynamicVolume` nunca se activa. Dos
  formas de llegar, ambas soportadas: (a) **una sola serie con todas las fases** (Philips
  Ingenia, estudio 800587: "Perfusion_Axial" = 6 × 150 cortes, y "sSubtraction" = 4 × 150); se
  parte agrupando por `ImagePositionPatient` repetida y ordenando por `InstanceNumber` dentro de
  cada posición; (b) series separadas del mismo estudio con `FrameOfReferenceUID` (que vive en
  `instances[i]`, no en el display set), filas/columnas, spacing, orientación, número de cortes y
  posición del primer y último corte iguales. Se prueba primero (a). Las derivadas (`ImageType`
  DERIVED o descripción SUB/MIP) quedan desactivadas por defecto pero se pueden activar.
- **La hora de cada fase se lee del archivo DICOM**, nunca del manifiesto: la API guarda ahí la
  hora del estudio, igual para todas las imágenes. Se usa `wadouri.dataSetCacheManager.get(url)`
  sobre el corte ya cargado (`x00080032`, respaldo `x00080033` y `x00181060`). Si el archivo no la
  trae o son iguales, el eje es por índice de fase y el panel lo avisa.
- Se carga **un solo corte por fase** por ROI (el más cercano a su centro), no la serie.
- Fórmulas fijas (ACR BI-RADS): realce inicial = (S₁−S₀)/S₀ con cortes 50 % y 100 %; tardío =
  (Sₙ−S₁)/S₁ con umbral ±10 % para tipo I/II/III. Sin tres fases o con S₀ ≤ 0 no se clasifica.
- El aviso de movimiento es un ajuste de parche 24×24 px por suma de diferencias absolutas
  respecto a la fase basal; con > 3 mm se marca la fase en la gráfica y se avisa. No se corrige.
- La gráfica es SVG propia (guía dataviz: línea 2 px, marcadores con anillo, rejilla hairline,
  crosshair + tooltip, leyenda sólo con ≥ 2 ROIs, un solo eje en realce %).
- Probado con el estudio de mama real 800587: 6 fases detectadas dentro de la serie y horas de
  adquisición reales leídas del archivo (0, 106, 172, 238, 304, 370 s). Falta la validación
  clínica de un radiólogo.
- `csUtils.worldToImageCoords` devuelve **[columna, fila]** (distancia a lo largo de rowCosines
  primero); el muestreo trabaja en [fila, columna]. Un despiste aquí muestrea el punto transpuesto.
- Para probar en local con estudios grandes hay que levantar el dev server con
  `--server-type https` (`yarn run dev --server-type https`) en vez de reenviar el CDN con un
  `page.route`: con 900 imágenes en prefetch el proxy de Playwright se cae por tiempo.

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

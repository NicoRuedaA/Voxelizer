# Voxelizer

Prototipo web para convertir sprites 2D en modelos voxel 3D exportables.

`Voxelizer` toma una imagen frontal, la cuantiza a una paleta reducida, genera una grilla de vóxeles y construye una malla optimizada con `greedy meshing`. Además, puede usar vistas auxiliares de perfil y cenital para reconstruir profundidad real mediante `visual hull`, y exporta el resultado a `.vox` y `.obj + .mtl`.

## Qué hace

- Convierte sprites o PNGs a una representación voxel 3D.
- Soporta extrusión uniforme o perfiles de relieve derivados del sprite.
- Acepta vistas `side` y `top` para mejorar la profundidad del volumen.
- Reduce caras con `greedy meshing`.
- Exporta a:
  - `.vox` para MagicaVoxel
  - `.obj + .mtl` para engines y DCC tools
- Incluye una suite mínima de regresión para los bugs críticos ya corregidos.

## Estado del proyecto

Esto es un prototipo funcional, no una aplicación cerrada de producción.

Hoy ya cubre bien el núcleo de voxelización y exportación, pero todavía tiene deuda en:

- accesibilidad
- responsive
- sanitización de algunos fragmentos HTML en la UI
- documentación técnica más profunda

## Stack

- HTML, CSS y JavaScript vanilla
- Three.js `r128` para visualización
- `node:test` para pruebas de regresión
- GitHub CLI (`gh`) para publicación del repo

No hay bundler, framework ni paso de build.

## Estructura

```text
Voxelizer_app/
|-- README.md
|-- .gitignore
|-- tests/
|   `-- voxelizer.test.js
`-- voxelizer/
    |-- index.html
    |-- app.js
    |-- voxel.js
    |-- voxio.js
    `-- data.js
```

## Arquitectura rápida

### `voxelizer/index.html`

Contiene la UI del prototipo y carga los scripts en orden.

### `voxelizer/app.js`

Orquesta estado, interacción de usuario, carga de imágenes, render 3D con Three.js y flujo de exportación.

### `voxelizer/voxel.js`

Es el core del proyecto. Ahí viven:

- lectura de píxeles
- cuantización de paleta
- perfiles de relieve
- generación de grilla voxel
- `visual hull`
- extracción de caras naive y greedy
- anotación de AO

### `voxelizer/voxio.js`

Encapsula la exportación:

- `exportVox(result)` para MagicaVoxel
- `exportOBJ(result, opts)` para `.obj + .mtl`

### `tests/voxelizer.test.js`

Suite de regresión enfocada en los bugs importantes corregidos.

## Cómo ejecutarlo

La forma más simple es abrir directamente:

```text
voxelizer/index.html
```

en el navegador.

Si preferís servirlo como sitio estático, podés usar cualquier servidor HTTP simple. Por ejemplo:

```powershell
npx serve voxelizer
```

## Flujo de uso

1. Cargá uno o más PNGs desde el panel izquierdo.
2. Ajustá profundidad, alpha, paleta y modo de relieve.
3. Opcionalmente añadí vistas de perfil y/o cenital.
4. Revisá el modelo en el viewport.
5. Exportá a `.vox` o `.obj + .mtl`.

## Tests

Los tests actuales validan regresiones del core:

- `alpha=0` no debe voxelizar píxeles transparentes
- la cuantización no debe borrar vóxeles al reducir colores
- el `visual hull` debe respetar la profundidad pedida
- el `OBJ` debe referenciar el `.mtl` correcto con y sin AO

Ejecutar:

```powershell
node --test tests/voxelizer.test.js
```

## Decisiones técnicas importantes

- El proyecto sigue una separación razonable entre:
  - lógica pura de voxelización
  - capa de UI/render
  - capa de exportación
- La exportación OBJ se movió a `VoxIO` para hacerla testeable sin DOM.
- El `visual hull` ahora respeta `depth`, `depthMode` y `relief`.
- La cuantización ya no pierde píxeles cuando hay más colores de los que entran en la paleta final.

## Limitaciones actuales

- La UI todavía usa algunos `innerHTML` que conviene sanear.
- La carga de imágenes aplica un cap fijo de `96px` por performance.
- El layout todavía no está trabajado para pantallas chicas.
- No hay pipeline de CI, linting ni release process.
- No hay licencia definida todavía.

## Próximos pasos razonables

1. Sanear los puntos de `innerHTML` que hoy siguen abiertos.
2. Hacer configurable o explícito el cap de resolución de entrada.
3. Mejorar accesibilidad de controles interactivos.
4. Añadir responsive real.
5. Incorporar CI para correr la suite de regresión automáticamente.

## Contribución

Si vas a tocar el core, la vara técnica tiene que ser alta:

- no romper la semántica de alpha/transparencia
- no volver a introducir pérdida silenciosa de datos
- validar cambios con tests de regresión
- mantener separada la lógica pura del código de UI

## Licencia

Pendiente de definir.

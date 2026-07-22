# Roadmap de desarrollo — Voxelizer

## Objetivo general

La prioridad de Voxelizer no debería ser todavía una migración completa a Svelte ni una reescritura total del proyecto.

La aplicación ya cuenta con:

- Reconstrucción multivista.
- Web Workers.
- Greedy meshing.
- Edición de paletas.
- Exportación a varios formatos.
- Pruebas automatizadas.

El siguiente objetivo debe ser conseguir que la reconstrucción sea **predecible con sprites reales**, especialmente cuando hay:

- Vistas laterales.
- Diferencias de alineación.
- Accesorios finos.
- Báculos, lanzas o espadas.
- Sprites con grandes márgenes transparentes.

---

## Orden recomendado

```text
1. Congelar y reproducir errores
2. Corregir profundidad y alineación
3. Mejorar reconstrucción multivista
4. Mejorar la experiencia del usuario
5. Separar y ordenar el código
6. Introducir Vite
7. Introducir TypeScript gradualmente
8. Valorar Svelte
9. Añadir pruebas de navegador
10. Publicar una versión estable
```

---

# Fase 1 — Crear una base de pruebas reales

**Duración estimada:** 2–3 días

Antes de modificar más el algoritmo, deben guardarse casos reales que permitan comprobar si una modificación mejora o empeora el resultado.

## Tareas

- [ ] Añadir los sprites del personaje con báculo a `tests/fixtures/`.
- [ ] Incluir una vista frontal.
- [ ] Incluir una vista trasera.
- [ ] Incluir una vista derecha.
- [ ] Incluir una versión lateral ligeramente desalineada.
- [ ] Incluir una versión con báculo de un píxel.
- [ ] Incluir una versión con báculo de dos píxeles.
- [ ] Medir la cantidad total de vóxeles.
- [ ] Medir las dimensiones finales.
- [ ] Medir la cantidad de vóxeles amarillos.
- [ ] Verificar la presencia del báculo.
- [ ] Verificar la profundidad obtenida.
- [ ] Verificar la reducción del greedy meshing.
- [ ] Crear una prueba específica que falle cuando desaparezca el báculo.
- [ ] Añadir una galería pequeña de entradas y resultados esperados.
- [ ] Empezar a dividir las pruebas por áreas.

## Ejemplo de prueba

```js
assert.ok(
  result.yellowVoxelCount >= minimumStaffVoxels,
  'El báculo debe conservar una cantidad mínima de vóxeles amarillos'
);
```

## Criterio de finalización

El problema del báculo debe poder reproducirse automáticamente sin abrir la interfaz.

---

# Fase 2 — Corregir `Match Profile` y la profundidad

**Duración estimada:** 3–5 días

El tamaño del lienzo no debe confundirse con el tamaño físico del personaje.

Un sprite lateral de 64×64 no debería producir automáticamente unas 64 capas de profundidad si la silueta solo ocupa, por ejemplo, 22 píxeles.

## Implementación recomendada

Calcular la profundidad desde el área opaca:

```js
const profileBounds = getOpaqueBounds(profilePixels);

const silhouetteWidth =
  profileBounds.maxX - profileBounds.minX + 1;
```

No desde el ancho completo del lienzo:

```js
const silhouetteWidth = profile.width;
```

## Tareas

- [ ] Calcular el bounding box de píxeles opacos.
- [ ] Recortar automáticamente los márgenes transparentes.
- [ ] Mantener una opción para conservar el lienzo original.
- [ ] Añadir una profundidad máxima razonable.
- [ ] Mostrar el bounding box detectado.
- [ ] Mostrar la anchura real de la silueta.
- [ ] Avisar cuando la profundidad sea casi igual al ancho frontal.
- [ ] Añadir una escala independiente para el perfil.
- [ ] Permitir profundidad automática, manual y escalada.

## Interfaz sugerida

```text
Perfil detectado: 22 px
Profundidad resultante: 22 vóxeles
Lienzo original: 64 px
```

```text
Profundidad:
● Automática desde silueta
○ Manual
○ Escalada
```

## Criterio de finalización

Un perfil de 64×64 cuya silueta ocupe 22 píxeles debe producir aproximadamente 22 capas, no 64.

---

# Fase 3 — Añadir alineación automática entre vistas

**Duración estimada:** 1 semana

El algoritmo no debería depender de que el artista alinee todos los sprites con precisión perfecta.

## Proceso recomendado

Antes de fusionar las vistas:

1. Obtener el bounding box opaco.
2. Localizar los pies o la base.
3. Localizar el centro horizontal.
4. Normalizar la altura.
5. Compensar desplazamientos.
6. Mostrar la transformación aplicada.

## Estructura sugerida

```js
const viewTransform = {
  offsetX: 2,
  offsetY: -1,
  scaleX: 1,
  scaleY: 1,
  flipped: false
};
```

## Controles manuales

```text
Mover X: -3 … +3
Mover Y: -3 … +3
Escala: 90% … 110%
Espejar horizontalmente
```

## Vista de comparación sugerida

```text
Frontal: cian
Trasera: magenta
Coincidencia: blanco
Conflicto: rojo
```

## Tareas

- [ ] Crear una función común para calcular transformaciones.
- [ ] Alinear las vistas por la base.
- [ ] Alinear las vistas por el centro de masa o centro horizontal.
- [ ] Permitir compensación manual.
- [ ] Permitir espejado horizontal.
- [ ] Permitir ajuste de escala.
- [ ] Mostrar una superposición de vistas.
- [ ] Mostrar conflictos de silueta.
- [ ] Guardar las transformaciones dentro del proyecto.

## Criterio de finalización

Una desviación lateral de uno o dos píxeles no debe destruir la cara, los pies ni el báculo.

---

# Fase 4 — Mejorar la reconstrucción multivista

**Duración estimada:** 1–2 semanas

Esta es la fase más importante del roadmap.

Una intersección estricta de siluetas funciona bien con cuerpos compactos, pero puede eliminar accesorios que no aparecen perfectamente en todas las proyecciones.

---

## 4.1 Separar geometría y color

No mezclar estas dos decisiones:

```text
¿Existe el vóxel?
¿Qué color tiene?
```

Usar dos pasos independientes:

```js
const occupancy = reconstructOccupancy(views, options);
const colors = projectViewColors(occupancy, views, options);
```

## Tareas

- [ ] Crear un paso exclusivo para ocupación.
- [ ] Crear un paso exclusivo para color.
- [ ] Evitar que una diferencia de color elimine geometría.
- [ ] Mantener información sobre la vista que aportó cada color.
- [ ] Añadir pruebas independientes para geometría y color.

---

## 4.2 Ofrecer tres modos de reconstrucción

### Modo estricto

```js
front && side && top
```

Adecuado para sprites perfectamente alineados.

### Modo ponderado

```js
front * 1.0 + side * 0.5 + top * 0.5 >= threshold
```

Adecuado para referencias artísticas y vistas imperfectas.

### Modo preservar frontal

```js
front && (sideMatch || thinComponent || edgeTolerance)
```

Adecuado para pixel art con accesorios.

## Tareas

- [ ] Mantener el modo estricto.
- [ ] Mejorar el modo ponderado.
- [ ] Añadir el modo preservar frontal.
- [ ] Permitir configurar pesos por vista.
- [ ] Permitir configurar el umbral.
- [ ] Añadir tolerancia de borde.
- [ ] Mostrar una descripción clara de cada modo.

---

## 4.3 Preservar componentes finos

Detectar componentes conectados en la máscara frontal:

```js
const components = findConnectedComponents(frontMask);
```

Clasificarlos mediante:

- Anchura.
- Altura.
- Relación de aspecto.
- Área.
- Grosor medio.
- Conexión con el cuerpo principal.
- Color.
- Posición respecto al contorno.

## Clasificación sugerida

```text
Cuerpo principal   → reconstrucción multivista
Báculo             → extrusión fina preservada
Espada             → extrusión fina preservada
Orbe               → volumen auxiliar
Partículas sueltas → opcional
```

## Regla inicial de ejemplo

```js
if (component.width <= 3 && component.height >= 8) {
  preserveThinComponent(component, {
    depth: 2,
    attachToMainVolume: true
  });
}
```

## Tareas

- [ ] Implementar componentes conectados.
- [ ] Identificar el componente principal.
- [ ] Detectar componentes estrechos y alargados.
- [ ] Permitir preservar accesorios finos.
- [ ] Permitir configurar su profundidad mínima.
- [ ] Asegurar la conexión con el volumen principal.
- [ ] Evitar preservar ruido o píxeles aislados.
- [ ] Añadir tests para báculos, lanzas y espadas.

---

## 4.4 Añadir un mapa de confianza

Cada vóxel puede almacenar información de confianza:

```js
const voxelConfidence = {
  frontConfidence: 1,
  sideConfidence: 0.4,
  topConfidence: 0,
  finalConfidence: 0.72
};
```

## Modos de depuración

```text
Ver:
○ Modelo
○ Siluetas
○ Confianza
○ Conflictos
○ Fuente de color
```

## Tareas

- [ ] Calcular confianza por vista.
- [ ] Calcular confianza final.
- [ ] Identificar vóxeles con conflicto.
- [ ] Mostrar el mapa de confianza.
- [ ] Mostrar la fuente del color.
- [ ] Permitir inspeccionar vóxeles dudosos.

## Criterio de finalización

Deben quedar resueltos estos tres casos:

- [ ] Frontal + trasera conserva el báculo.
- [ ] Frontal + derecha no convierte el personaje en un bloque excesivamente profundo.
- [ ] Una ligera desalineación no elimina detalles finos.

---

# Fase 5 — Mejorar la interfaz

**Duración estimada:** 4–7 días

La interfaz debe explicar claramente qué está haciendo el algoritmo.

## Cambios de texto

Sustituir explicaciones ambiguas como:

> Las vistas adicionales se usan para fusionar color.

Por una explicación más exacta:

> Las vistas adicionales restringen la forma y la profundidad del modelo, y aportan color a sus caras. Una mala alineación puede eliminar detalles finos.

## Mostrar los ejes

```text
Frontal:    X / Y
Trasera:   -X / Y
Derecha:    Z / Y
Izquierda: -Z / Y
Superior:   X / Z
```

## Añadir presets

```text
Extrusión simple
Personaje compacto
Personaje con accesorios
Multivista estricta
Multivista tolerante
```

## Preset sugerido para accesorios

```js
const accessoryPreset = {
  reconstructionMode: 'weighted',
  preserveThinComponents: true,
  edgeTolerance: 2,
  profileWeight: 0.5,
  maxAutomaticDepthRatio: 0.5
};
```

## Tareas

- [ ] Mejorar los textos de ayuda.
- [ ] Unificar el idioma de la interfaz.
- [ ] Mostrar unidades en los sliders.
- [ ] Añadir tooltips.
- [ ] Añadir botones para restaurar valores.
- [ ] Mostrar advertencias junto al control problemático.
- [ ] Añadir presets.
- [ ] Añadir comparación antes/después.
- [ ] Añadir una vista de superposición.
- [ ] Añadir una guía para crear sprites compatibles.

## Criterio de finalización

Un usuario debe poder cargar frontal, trasera y lateral sin conocer el funcionamiento interno de la intersección de siluetas.

---

# Fase 6 — Separar el código sin cambiar de tecnología

**Duración estimada:** 1–2 semanas

No introducir todavía Svelte.

Primero debe separarse la lógica usando JavaScript normal y módulos ES.

## Estructura recomendada

```text
voxelizer/
├── app/
│   ├── state.js
│   ├── dom.js
│   ├── file-controller.js
│   ├── reconstruction-controller.js
│   ├── palette-controller.js
│   └── export-controller.js
│
├── core/
│   ├── image-mask.js
│   ├── bounds.js
│   ├── alignment.js
│   ├── components.js
│   ├── reconstruction.js
│   ├── confidence.js
│   └── voxel-grid.js
│
├── meshing/
│   ├── exposed-faces.js
│   └── greedy-meshing.js
│
├── export/
│   ├── obj.js
│   ├── vox.js
│   ├── glb.js
│   └── fbx.js
│
├── viewport/
│   ├── scene.js
│   ├── cameras.js
│   └── model-renderer.js
│
└── workers/
    ├── worker.js
    ├── worker-client.js
    └── worker-protocol.js
```

## Regla principal

El directorio `core/` no debe conocer:

- `document`.
- `window`.
- HTML.
- Three.js.
- Botones.
- Sliders.
- Estado visual de la interfaz.

El núcleo debe poder ejecutarse así:

```js
const result = reconstruct({
  views,
  configuration
});
```

## Tareas

- [ ] Separar el estado de la interfaz.
- [ ] Separar la carga de archivos.
- [ ] Separar la reconstrucción.
- [ ] Separar el meshing.
- [ ] Separar los exportadores.
- [ ] Separar el viewport.
- [ ] Separar el protocolo del worker.
- [ ] Eliminar dependencias del DOM en el núcleo.
- [ ] Reducir variables globales.
- [ ] Añadir tests por módulo.

## Criterio de finalización

Cada módulo del núcleo debe poder probarse sin navegador y sin crear elementos del DOM.

---

# Fase 7 — Introducir Vite

**Duración estimada:** 2–4 días

Vite debe introducirse después de estabilizar el algoritmo y ordenar los módulos.

## Instalación

```bash
npm install --save-dev vite
```

## Scripts sugeridos

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --test tests/**/*.test.js",
    "check": "node scripts/check.js"
  }
}
```

## Convertir la entrada a módulo

```html
<script type="module" src="/voxelizer/main.js"></script>
```

## Crear el worker de forma compatible con el build

```js
const worker = new Worker(
  new URL('./workers/worker.js', import.meta.url),
  { type: 'module' }
);
```

## Añadir al CI

```bash
npm install
npm test
npm run build
```

## Tareas

- [ ] Instalar Vite.
- [ ] Cambiar el servidor de desarrollo.
- [ ] Convertir los scripts a módulos.
- [ ] Migrar Three.js a dependencias npm.
- [ ] Adaptar el Web Worker.
- [ ] Configurar la ruta base para GitHub Pages.
- [ ] Añadir el build al CI.
- [ ] Verificar la carpeta `dist/`.
- [ ] Documentar el nuevo flujo de desarrollo.

## Criterio de finalización

Un nuevo desarrollador debe poder ejecutar:

```bash
npm install
npm run dev
npm run build
```

Y obtener una carpeta `dist/` publicable.

---

# Fase 8 — Introducir TypeScript gradualmente

**Duración estimada:** 1–2 semanas

No convertir toda la aplicación en un único commit.

## Orden recomendado

Primero:

```text
worker-protocol.ts
types/voxel.ts
types/views.ts
types/configuration.ts
core/bounds.ts
core/alignment.ts
core/reconstruction.ts
```

Después:

```text
exportadores
viewport
controladores de interfaz
```

## Tipos importantes

```ts
type ViewRole =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'profile';

interface ViewTransform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  flipped: boolean;
}

interface SpriteView {
  role: ViewRole;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  transform: ViewTransform;
}

interface VoxelGrid {
  width: number;
  height: number;
  depth: number;
  occupancy: Uint8Array;
  colorIndices: Uint16Array;
}
```

## Script de comprobación

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

## Tareas

- [ ] Tipar las vistas.
- [ ] Tipar la configuración.
- [ ] Tipar el voxel grid.
- [ ] Tipar los resultados.
- [ ] Tipar los mensajes del worker.
- [ ] Tipar la reconstrucción.
- [ ] Tipar los exportadores.
- [ ] Añadir `tsc --noEmit` al CI.
- [ ] Activar el modo estricto gradualmente.

## Criterio de finalización

Los mensajes enviados al worker, las vistas, la configuración y los resultados no deben depender de objetos informales sin validar.

---

# Fase 9 — Valorar Svelte

**Duración estimada:** opcional, 1–3 semanas

Svelte solo debe introducirse cuando la interfaz sea difícil de mantener con manipulación manual del DOM.

## Señales para adoptar Svelte

- El inspector tiene demasiados estados visuales.
- Existen muchos slots repetidos.
- Se actualiza manualmente demasiado DOM.
- Hay errores de sincronización entre estado y controles.
- Los paneles tienen lógica duplicada.
- Añadir nuevas opciones exige modificar demasiados lugares.

## Elementos candidatos a migrar

```text
Inspector
BatchPanel
SpriteSlot
Toolbar
StatusBar
PaletteEditor
```

El núcleo, el worker y Three.js no deben depender de Svelte.

## Ejemplo de integración del viewport

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { VoxelViewport } from '../viewport/VoxelViewport';

  let container;

  onMount(() => {
    const viewport = new VoxelViewport(container);

    return () => {
      viewport.dispose();
    };
  });
</script>

<div bind:this={container} class="viewport"></div>
```

## Criterio de finalización

La interfaz puede migrarse por paneles sin reescribir el motor de voxelización.

---

# Fase 10 — Pruebas de navegador y publicación

**Duración estimada:** 1 semana

Además de las pruebas unitarias, deben añadirse pruebas completas del flujo de usuario.

## Flujos mínimos con Playwright

```text
Carga un frontal
Carga una trasera
Carga un perfil
Genera el modelo
Comprueba dimensiones
Cambia tolerancia
Exporta GLB
Exporta VOX
```

## Tareas

- [ ] Añadir Playwright.
- [ ] Probar carga de imágenes.
- [ ] Probar drag-and-drop.
- [ ] Probar selección de vistas.
- [ ] Probar generación.
- [ ] Probar cambios de profundidad.
- [ ] Probar tolerancia de bordes.
- [ ] Probar cancelación del worker.
- [ ] Probar exportación.
- [ ] Probar errores de entrada.
- [ ] Ejecutar pruebas en Chromium.
- [ ] Ejecutar pruebas en Firefox.
- [ ] Ejecutar pruebas en WebKit.

## Validar exportadores

Crear fixtures de referencia para:

- VOX.
- OBJ/MTL.
- GLB.
- FBX.

Comprobar:

- [ ] Número de vértices.
- [ ] Número de triángulos.
- [ ] Materiales.
- [ ] Bounding box.
- [ ] Ausencia de `NaN`.
- [ ] Índices dentro de rango.
- [ ] Archivo importable en aplicaciones externas.

## Preparar una release

Publicar una versión `v0.6.0` con:

- [ ] ZIP de la aplicación.
- [ ] Demo web.
- [ ] Sprites de ejemplo.
- [ ] Capturas de vistas frontal, lateral y 3D.
- [ ] Changelog.
- [ ] Limitaciones conocidas.
- [ ] Guía para crear sprites.
- [ ] Instrucciones de desarrollo.
- [ ] Instrucciones de despliegue.

---

# Plan de 30 días

## Semana 1

- [ ] Añadir fixtures reales.
- [ ] Reproducir el problema del báculo.
- [ ] Corregir `Match Profile`.
- [ ] Calcular profundidad desde la silueta opaca.

## Semana 2

- [ ] Añadir alineación automática.
- [ ] Añadir tolerancia de bordes.
- [ ] Separar ocupación y color.
- [ ] Mejorar el modo ponderado.

## Semana 3

- [ ] Preservar accesorios finos.
- [ ] Añadir mapa de confianza.
- [ ] Mejorar textos y presets.
- [ ] Dividir las pruebas.

## Semana 4

- [ ] Separar `app.js` y `voxel.js`.
- [ ] Introducir Vite.
- [ ] Añadir el build al CI.
- [ ] Publicar una primera beta.

---

# Priorización resumida

## Hacer ahora

1. Crear regresiones con sprites reales.
2. Corregir la profundidad calculada desde el perfil.
3. Añadir alineación y tolerancia.
4. Preservar componentes finos.
5. Separar geometría y color.

## Hacer después

6. Dividir los archivos principales.
7. Introducir Vite.
8. Introducir TypeScript.
9. Añadir pruebas de navegador.
10. Publicar `v0.6.0`.

## No hacer todavía

- Reescribir todo en Svelte.
- Pasar todo a TypeScript en un único commit.
- Introducir WebAssembly sin medir rendimiento.
- Refactorizar la interfaz y el algoritmo al mismo tiempo.
- Añadir más formatos de exportación antes de estabilizar la reconstrucción.
- Optimizar el greedy meshing para ocultar errores que ya existen en el volumen.

---

# Objetivo propuesto para Voxelizer 0.6

> **Voxelizer 0.6: reconstrucción multivista predecible, alineación automática y preservación de accesorios finos.**

## Resultado esperado

Al completar este roadmap, Voxelizer debería:

- Reconstruir personajes compactos con proporciones coherentes.
- Conservar báculos, espadas, lanzas y otros accesorios finos.
- Tolerar pequeños errores de alineación.
- Calcular la profundidad desde la silueta real.
- Separar correctamente geometría y color.
- Explicar al usuario cómo influyen las vistas adicionales.
- Tener un núcleo modular y comprobable.
- Usar un flujo de desarrollo reproducible.
- Generar builds listos para publicar.
- Contar con pruebas unitarias y pruebas reales de navegador.

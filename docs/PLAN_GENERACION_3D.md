# Plan por fases: mejora de la generacion 3D

## Objetivo

Mejorar la fidelidad de los modelos sin eliminar el flujo actual ni imponer un
unico tipo de reconstruccion. Cada capacidad nueva debe ser opcional, tener
valores seguros por defecto y poder combinarse desde la UI.

## Principios de implementacion

- Mantener el resultado actual cuando todas las opciones nuevas esten apagadas.
- Separar procesamiento de imagen, reconstruccion volumetrica y generacion de malla.
- Ejecutar el trabajo pesado dentro del worker.
- Guardar configuraciones como datos serializables, sin referencias al DOM.
- Añadir tests de regresion antes de cambiar cada algoritmo.
- No mezclar mejoras geometricas con cambios puramente visuales del visor.
- Limitar rangos y resoluciones para evitar bloqueos por consumo de memoria.

## Modelo de configuracion propuesto

```js
{
  silhouette: {
    enabled: false,
    denoiseRadius: 0,
    closeRadius: 0,
    feather: 0,
    resampling: "nearest"
  },
  alignment: {
    side: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: false },
    top: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, flipX: false }
  },
  reconstruction: {
    mode: "strict",
    threshold: 1,
    frontWeight: 1,
    sideWeight: 1,
    topWeight: 1
  },
  depth: {
    mode: "symmetric",
    frontRatio: 0.5,
    depthMapStrength: 1,
    invertDepthMap: false
  },
  mesh: {
    mode: "voxel",
    smoothing: 0,
    isoLevel: 0.5
  }
}
```

Los nombres definitivos pueden ajustarse durante la implementacion, pero la
estructura debe conservar grupos independientes para evitar un objeto plano
dificil de mantener.

## Fase 0: base tecnica y compatibilidad

### Alcance

- Centralizar los valores por defecto y la normalizacion de opciones.
- Versionar la configuracion para soportar cambios futuros.
- Separar el pipeline en funciones puras:
  - preparar siluetas;
  - transformar vistas;
  - calcular ocupacion;
  - generar profundidad;
  - extraer malla.
- Añadir mediciones de tiempo por etapa y estimacion de memoria.
- Crear fixtures pequeños para frontal, lateral, cenital y mapa de profundidad.

### UI

- Crear una seccion `Reconstruccion avanzada`.
- Mantenerla contraida inicialmente.
- Añadir un boton `Restablecer` por grupo.
- Deshabilitar controles que no apliquen al modo seleccionado.

### Tests

- La configuracion por defecto produce el mismo grid que la version actual.
- Las opciones incompletas o antiguas se normalizan correctamente.
- El worker recibe y devuelve configuraciones sin perder campos.

### Criterio de cierre

El pipeline queda preparado para incorporar algoritmos nuevos sin alterar el
resultado actual.

## Fase 1: limpieza y remuestreo de siluetas

### Alcance

- Sustituir la mascara binaria directa por una etapa de preprocesamiento.
- Añadir eliminacion de ruido para componentes o puntos aislados.
- Añadir cierre morfologico para pequeños huecos.
- Ofrecer remuestreo `nearest`, `area` y `bilinear`.
- Mantener el umbral alpha como paso final configurable.

### UI

- Interruptor `Procesar silueta`.
- Control `Eliminar ruido`.
- Control `Cerrar huecos`.
- Selector `Remuestreo`.
- Vista previa 2D de la mascara resultante.

### Tests

- No se pierden extremidades de un pixel con los valores por defecto.
- El cierre rellena huecos dentro del radio solicitado.
- El filtro elimina ruido sin modificar regiones validas grandes.
- Cada remuestreo genera dimensiones y valores validos.

### Criterio de cierre

Las vistas auxiliares llegan limpias al visual hull y el usuario puede comparar
la mascara original con la procesada.

## Fase 2: alineacion multivista

### Alcance

- Transformar cada vista antes de generar su mascara.
- Soportar desplazamiento, escala, rotacion y espejo.
- Definir claramente los ejes frontal, lateral y cenital.
- Aplicar las transformaciones en un canvas intermedio dentro del worker.
- Incorporar una opcion de ajuste automatico inicial por bounding box.

### UI

- Controles independientes para vista lateral y cenital.
- Superposicion de guias y bounding boxes.
- Acciones `Ajuste automatico`, `Centrar` y `Restablecer`.
- Previsualizacion sincronizada de los ejes compartidos.

### Tests

- Las transformaciones respetan el centro y la orientacion esperados.
- El ajuste por bounding box alinea siluetas con margenes diferentes.
- Rotaciones y espejos no cambian las dimensiones finales del volumen.
- Una vista ausente no afecta a las restantes.

### Criterio de cierre

El usuario puede corregir fuentes descentradas o con escalas distintas antes de
que intersecten en el volumen.

## Fase 3: reconstruccion por confianza

### Alcance

- Conservar el modo `strict` actual.
- Añadir un modo `weighted` basado en votos de las vistas disponibles.
- Permitir peso independiente para frontal, lateral y cenital.
- Añadir un umbral de ocupacion y una tolerancia de borde.
- Exponer un mapa de confianza opcional para diagnostico.
- Evitar que una fila o columna vacia destruya regiones completas por error.

### UI

- Selector `Estricto` / `Por confianza`.
- Pesos por vista.
- Control de umbral.
- Control de tolerancia de borde.
- Modo de depuracion que coloree voxeles por confianza.

### Tests

- El modo estricto reproduce exactamente el comportamiento previo.
- Una discrepancia de una vista puede conservarse con el umbral adecuado.
- Los pesos cambian la decision de ocupacion de forma determinista.
- Nunca se crean voxeles fuera de la silueta frontal salvo opcion explicita.

### Criterio de cierre

La reconstruccion tolera pequeñas diferencias entre vistas sin convertir el
modelo en un volumen arbitrario.

## Fase 4: profundidad asimetrica y mapas de profundidad

### Alcance

- Mantener el modo simetrico actual.
- Añadir reparto frontal/trasero configurable.
- Admitir un mapa de profundidad en escala de grises.
- Permitir invertir, escalar y suavizar el mapa.
- Definir comportamiento cuando el mapa no coincide en resolucion.
- Combinar el mapa de profundidad con el visual hull sin superar sus limites.

### UI

- Selector `Simetrica`, `Asimetrica` o `Mapa de profundidad`.
- Control de proporcion frontal/trasera.
- Slot de carga para el mapa.
- Controles de intensidad, inversion y suavizado.
- Previsualizacion 2D del mapa normalizado.

### Tests

- El modo simetrico mantiene la geometria existente.
- Los extremos 0/100 del reparto colocan correctamente el volumen.
- Negro y blanco producen los limites de profundidad definidos.
- Un mapa transparente o invalido muestra un error recuperable.
- El visual hull sigue siendo el limite exterior del volumen.

### Criterio de cierre

La aplicacion puede generar una espalda distinta del frente y usar informacion
de profundidad explicita sin romper los formatos de exportacion.

## Fase 5: malla suave opcional

Esta fase es independiente de las cuatro mejoras principales. Debe abordarse
solo cuando la ocupacion volumetrica sea fiable.

### Alcance

- Mantener `Voxel + greedy meshing` como modo principal.
- Añadir `Marching Cubes` como salida suavizada.
- Evaluar `Dual Contouring` si es necesario preservar esquinas.
- Generar normales y deduplicar vertices para OBJ.
- Definir como se transfieren los colores del grid a la superficie.

### UI

- Selector `Voxel` / `Suave`.
- Controles de suavizado e iso-superficie.
- Comparacion de numero de caras y memoria estimada.

### Tests

- La malla queda cerrada y sin triangulos degenerados.
- Los indices siempre apuntan a vertices validos.
- El color se conserva dentro de una tolerancia definida.
- La exportacion OBJ abre correctamente con ambos modos.

### Criterio de cierre

El usuario puede elegir entre estetica voxel y superficie suavizada sin mezclar
los algoritmos ni cambiar silenciosamente el formato.

## Fase 6: presets, persistencia y experiencia final

### Alcance

- Añadir presets `Pixel art`, `Detalle fino`, `Tolerante` y `Mapa de profundidad`.
- Guardar la configuracion en `localStorage`.
- Permitir importar y exportar presets en JSON.
- Incluir la configuracion usada dentro del ZIP del batch.
- Añadir advertencias cuando una combinacion sea costosa o contradictoria.

### Tests

- Los presets producen configuraciones completas y validas.
- Una configuracion guardada se restaura entre sesiones.
- Los presets antiguos migran mediante la version de configuracion.
- La exportacion batch conserva una copia de los parametros.

### Criterio de cierre

La personalizacion es reutilizable y reproducible, no solamente un conjunto de
sliders que el usuario debe recordar.

## Orden de entrega recomendado

1. Fase 0: base tecnica.
2. Fase 1: siluetas.
3. Fase 2: alineacion.
4. Fase 3: confianza.
5. Fase 4: profundidad.
6. Fase 6: presets y persistencia.
7. Fase 5: malla suave, como evolucion opcional.

## Estrategia de commits

- Un commit de tests y contratos por fase.
- Un commit del core por capacidad coherente.
- Un commit de UI y documentacion cuando el core ya este validado.
- Commits convencionales, sin mezclar refactors no relacionados.

Ejemplos:

```text
test: cover silhouette preprocessing
feat: add configurable silhouette cleanup
feat: add multiview alignment controls
feat: add weighted voxel reconstruction
feat: support asymmetric depth maps
```

## Riesgos y limites

- A mayor resolucion y profundidad, el grid crece de forma cubica en el peor caso.
- El filtrado excesivo puede borrar detalles propios del pixel art.
- Una reconstruccion por confianza mejora tolerancia, pero tambien puede crear
  volumen donde las fuentes no aportan informacion suficiente.
- Un mapa de profundidad generado automaticamente no equivale a geometria real.
- La malla suave exige otra estrategia de color y puede aumentar mucho las caras.
- La alineacion automatica por bounding box no resuelve diferencias de perspectiva.

## Definicion global de terminado

- El comportamiento anterior sigue disponible y cubierto por tests.
- Todas las opciones tienen ayuda contextual y limites claros.
- El procesamiento pesado permanece fuera del hilo principal.
- Cancelacion, preview y batch utilizan exactamente el mismo pipeline.
- Los resultados son deterministas con la misma entrada y configuracion.
- README y ejemplos reflejan los modos disponibles.

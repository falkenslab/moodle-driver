# Tableros

Actividades de tablero (módulo `board`, el plugin mod_board de Brickfield, que el sitio debe tener instalado), tal como las preparan los profesores: las columnas de un tablero leídas, con cuántas notas tiene cada una, y fijadas, añadidas, renombradas, bloqueadas y eliminadas. El tablero en sí se crea con `createActivity({ type: "board", … })` (consulta [Actividades y secciones](activities.md)): viene con tres columnas tituladas "Heading", que `setBoardColumns` sustituye.

**Términos:** [tablero](../reference/glossary.md#board), [id del módulo del curso](../reference/glossary.md#course-module-id).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

El driver lee la página del tablero para conocer su id de instancia (lo nombra la llamada que arranca el script del tablero), y después trabaja como lo hace la página del tablero: los servicios AJAX del plugin leen el tablero y sus ajustes, bloquean y eliminan columnas, y sus propios formularios de columna (`column_create_ajax.php`, `column_update_ajax.php`, que no tienen servicio) las añaden y renombran. Funciona en cualquier idioma de la interfaz. Todas las funciones lanzan `NotABoardError` cuando el id no es un tablero que la persona pueda abrir, `BoardError` cuando Moodle lo rechaza (con el mensaje de Moodle y la capacidad que requiere) y `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)). Cambiar columnas requiere `mod/board:manageboard`, que tienen los profesores.

## boardColumns

Las columnas de un tablero, en el orden del tablero.

```ts
function boardColumns(context: BrowserContext, siteUrl: string, activityId: number, options?: BoardColumnsOptions): Promise<BoardColumn[]>;

interface BoardColumnsOptions {
  groupId?: number;
  ownerId?: number;
}

interface BoardColumn {
  id: number;
  name: string;
  colour: string;
  locked: boolean;
  notes: number;
}
```

- `colour`: el color con el que el tablero pinta la cabecera de la columna, `#1B998B`. Una columna no tiene color propio: el tablero lo toma de la lista de colores de columna del sitio (el ajuste del plugin, cosa de un administrador) según el id de la columna, así que el driver lo lee y nunca lo fija.
- `locked`: los participantes no pueden añadir notas a la columna.
- `notes`: cuántas notas tiene la columna. Para quien gestiona el tablero, las de todos los grupos y todos los participantes; para cualquier otro, las que puede ver. `groupId` cuenta las de un grupo en un tablero con grupos; `ownerId` las de un participante en un tablero en modo de un solo usuario (un tablero por participante, con las mismas columnas en cada uno).
- Un tablero que oculta sus cabeceras muestra a quien no lo gestiona la posición de cada columna ("1", "2"…) en lugar de su nombre, y lo mismo hace `boardColumns`.
- Leer la página del tablero registra una visita, como abrirlo.
- `BoardError` cuando un tablero en modo de un solo usuario no tiene a nadie que mostrar (aún sin participantes, o un `ownerId` que no ofrece).

## setBoardColumns

Hace que las columnas de un tablero sean estas, en este orden.

```ts
function setBoardColumns(context: BrowserContext, siteUrl: string, activityId: number, columns: (string | BoardColumnInput)[], options?: BoardColumnRemoval): Promise<BoardColumnsChange>;

interface BoardColumnInput {
  name: string;
  locked?: boolean;
}

interface BoardColumnRemoval {
  deleteNotes?: boolean;
}

interface BoardColumnsChange {
  changed: string;
  columns: BoardColumn[];
}
```

- Las columnas del tablero se renombran en su sitio, una a una, las que faltan se añaden al final y las que sobran se eliminan desde el final, como lo haría un profesor a mano: una columna renombrada conserva su id y sus notas.
- Una columna es un nombre, o un nombre y si está bloqueada; sin `locked` una columna se queda como está (una nueva, desbloqueada).
- Los nombres admiten hasta 100 caracteres (Moodle cortaría uno más largo); una lista vacía o un nombre vacío es `invalid-input`.
- Eliminar una columna con notas se rechaza con `BoardError` antes de cambiar nada, salvo con `deleteNotes`: Moodle borra sus notas, con sus comentarios y valoraciones, y no se puede deshacer.

## addBoardColumn

Añade una columna al final de un tablero, como hace el "+" del tablero.

```ts
function addBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, column: BoardColumnInput): Promise<BoardColumnChange>;

interface BoardColumnChange {
  changed: string;
  columnId: number;
  columns: BoardColumn[];
}
```

- `columnId` es el de la columna nueva; `columns`, las del tablero después.
- Con `locked`, queda bloqueada desde el principio.

## editBoardColumn

Renombra una columna, la bloquea o la desbloquea, como hace su menú.

```ts
function editBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, columnId: number, changes: BoardColumnChanges): Promise<BoardColumnChange>;

interface BoardColumnChanges {
  name?: string;
  locked?: boolean;
}
```

- Lo que no se da se queda igual; no dar nada es `invalid-input`. Un cambio a lo que la columna ya es no cambia nada, y `changed` lo dice.
- `BoardError` cuando la columna no está en el tablero (toma su id de `boardColumns`).

## removeBoardColumn

Elimina una columna, como hace su menú.

```ts
function removeBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, columnId: number, options?: BoardColumnRemoval): Promise<BoardColumnChange>;
```

- Una columna con notas se rechaza con `BoardError` salvo con `deleteNotes`, como en `setBoardColumns`.
- `BoardError` cuando la columna no está en el tablero.

## Ejemplo {#example}

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const created = await moodle.createActivity({ courseId: 12, sectionId: 80, type: "board", name: "Retrospectiva", visibility: "hidden" });
const activityId = created.activityId!;

// Sus tres columnas "Heading" pasan a ser estas, la última bloqueada.
await moodle.setBoardColumns(activityId, ["Fue bien", "A mejorar", { name: "Acciones", locked: true }]);

for (const column of await moodle.boardColumns(activityId)) {
  console.log(`${column.name}${column.locked ? " (bloqueada)" : ""}: ${column.notes} notas`);
}

const actions = (await moodle.boardColumns(activityId)).find((column) => column.name === "Acciones")!;
await moodle.editBoardColumn(activityId, actions.id, { name: "Próximos pasos", locked: false });
```

## Categorías de datos {#data-categories}

`boardColumns` es `course-content` y `others-aggregate` (las columnas son del profesor; el número de notas habla de las notas de todos, sin nombrar a nadie); `addBoardColumn` y `editBoardColumn` son `course-content`; `setBoardColumns` y `removeBoardColumn` son `course-content` y `others-write`, porque eliminar una columna con notas (cuando se pide) borra notas de los participantes. Consulta [Categorías de datos](../concepts/data-categories.md).

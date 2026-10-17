# Bases de datos

Actividades de base de datos (módulo `data`), tal como las configura un profesor: sus campos (uno por cada tipo de dato que guarda una entrada), sus plantillas (cómo se listan, se muestran, se añaden y se buscan las entradas) y los preajustes del sitio, que le dan ambas cosas a la vez; y sus [entradas](#entries), tal como las añaden los participantes y los profesores las revisan, las aprueban y las sacan y meten como CSV. La base de datos en sí se crea con `createActivity({ type: "data", … })` (consulta [Actividades y secciones](activities.md)); sus entradas se valoran con `rate` (consulta [Calificación](grading.md#rate)).

**Términos:** [base de datos](../reference/glossary.md#database), [id del módulo del curso](../reference/glossary.md#course-module-id).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

Moodle no abre a AJAX la configuración de una base de datos: todo pasa por sus páginas de campos, plantillas y preajustes (`mod/data/field.php`, `templates.php`, `preset.php`), leídas por los nombres de sus campos, los enlaces de la tabla de campos y sus iconos, así que funciona en cualquier idioma de la interfaz. Requieren la capacidad de Moodle `mod/data:managetemplates`, que tienen los profesores. Todas estas funciones lanzan `NotADatabaseError` cuando el id no es una base de datos, `DatabaseError` cuando Moodle niega a la persona su configuración (con el mensaje de Moodle) y `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## databaseFields

Los campos de una base de datos, en el orden de la página de campos, cada uno leído de su formulario de edición.

```ts
function databaseFields(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabaseField[]>;

interface DatabaseField {
  id: number;
  name: string;
  type: DatabaseFieldType | string;
  description: string;
  required: boolean;
  options: DatabaseFieldOptions;
}
```

- `type`: uno de `DATABASE_FIELD_TYPES`, los tipos del núcleo de Moodle: `text` (texto corto), `textarea` (área de texto), `number`, `date`, `menu` (lista desplegable), `radiobutton` (botones de opción), `checkbox` (casillas de verificación), `multimenu` (lista de selección múltiple), `url`, `file` (archivo), `picture` (imagen) y `latlong` (coordenadas). Un campo de otro plugin viene con el nombre de su plugin y sin `options`.
- `required`: si una entrada lo necesita; un campo de fecha no puede ser obligatorio (el formulario de Moodle para él no tiene ese ajuste).
- `options`: los ajustes propios del tipo, más abajo. Una lista vacía para una base de datos sin campos.

### Opciones de los campos {#field-options}

Cada tipo acepta sus propias opciones; las demás se rechazan:

| Tipo | Opciones |
| --- | --- |
| `menu`, `radiobutton`, `checkbox`, `multimenu` | `choices`: las opciones, en orden (una por línea en el formulario de Moodle) |
| `text` | `autolink`: Moodle enlaza el texto allí donde aparece en el resto del curso |
| `url` | `autolink`: la URL es un enlace; `linkName`: el texto del enlace en lugar de la URL; `newWindow`: se abre en una ventana nueva |
| `textarea` | `columns`, `rows`: su tamaño; `maxBytes`: el archivo más grande que admite |
| `file` | `maxBytes`: el archivo más grande |
| `picture` | `width`, `height`: en la vista individual, `listWidth`, `listHeight`: en la vista de lista, en píxeles (ninguno es el tamaño propio de la imagen); `maxBytes` |
| `latlong` | `services`: los servicios de mapas a los que enlazan las coordenadas, por sus nombres en Moodle (`"Google Maps"`, `"Google Earth"`, `"Geabios"`, `"OpenStreetMap"`, `"Multimap"`); `kmlLabel`: cómo etiquetan las entradas los archivos KML de Google Earth, `"entry"` (su número), `"coordinates"` o el id de un campo de texto |
| `number`, `date` | ninguna |

`maxBytes` va en bytes, 0 para el límite del sitio o del curso; un campo de archivo o de imagen acepta uno de los tamaños que ofrece su formulario (1048576 para 1 MB…), un área de texto cualquiera.

## addDatabaseField

Añade un campo con el formulario de Moodle para su tipo, como hace "Crear un campo".

```ts
function addDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, field: DatabaseFieldInput): Promise<{ changed: string; fieldId: number; fields: DatabaseField[] }>;

interface DatabaseFieldInput {
  type: DatabaseFieldType;
  name: string;
  description?: string;
  required?: boolean;
  options?: DatabaseFieldOptions;
}
```

- `name`: único en la base de datos; las plantillas nombran el campo por él (`[[name]]`).
- Devuelve el id del campo nuevo y todos los campos después.

Las plantillas que siguen con el valor por defecto de Moodle muestran el campo nuevo enseguida; Moodle lo añade al final de una plantilla individual, de añadir entrada o de RSS guardada que no tenga la etiqueta `##otherfields##`, no a la plantilla de lista. Lanza `MoodleError` (`invalid-input`) antes de cambiar nada para un tipo que no es del núcleo de Moodle, una opción que el tipo no acepta, un campo de opciones sin opciones, una fecha obligatoria o un tamaño que no es un número entero; `DatabaseError` con el motivo de Moodle cuando rechaza el campo (un nombre que la base de datos ya tiene, un tamaño máximo que su formulario no ofrece).

## editDatabaseField

Cambia un campo con su formulario de edición: lo que `changes` no incluye se queda como está, sus opciones una a una.

```ts
function editDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, fieldId: number, changes: DatabaseFieldChanges): Promise<{ changed: string; fields: DatabaseField[] }>;

interface DatabaseFieldChanges {
  name?: string;
  description?: string;
  required?: boolean;
  options?: DatabaseFieldOptions;
}
```

Renombrar un campo renombra su etiqueta en las plantillas, como hace Moodle. Su tipo no puede cambiar: elimínalo y añade otro. Lanza `MoodleError` (`not-found`) cuando la base de datos no tiene ese campo.

## deleteDatabaseField

Elimina un campo, como hace su acción de eliminar una vez confirmada: lo que las entradas tienen en él se va también, y sus etiquetas salen de las plantillas.

```ts
function deleteDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, fieldId: number): Promise<{ changed: string; fields: DatabaseField[] }>;
```

## databaseTemplates

Las plantillas de una base de datos, tal como las muestra su página de plantillas.

```ts
function databaseTemplates(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabaseTemplates>;

type DatabaseTemplates = Record<DatabaseTemplate, string>;
type DatabaseTemplate = "list" | "listHeader" | "listFooter" | "single" | "add" | "search" | "rss" | "rssTitle" | "css" | "js";
```

- `listHeader`, `list` (repetida para cada entrada) y `listFooter`: la vista de lista; `single`: una entrada; `add`: el formulario de añadir entrada; `search`: la búsqueda avanzada; `rssTitle` y `rss`: el canal RSS; `css` y `js`: el CSS y el JavaScript propios de la base de datos.
- Una plantilla nunca guardada da la de Moodle por defecto para los campos que tiene; una cabecera, un pie, un título de RSS, un CSS o un JavaScript vacíos siguen vacíos.

Moodle no tiene plantillas para una base de datos sin campos: `DatabaseError` hasta que tenga uno.

## setDatabaseTemplate

Guarda una plantilla tal cual, sin el editor HTML de Moodle de por medio (reescribiría el HTML), como hace el botón Guardar de la página de plantillas.

```ts
function setDatabaseTemplate(context: BrowserContext, siteUrl: string, activityId: number, template: DatabaseTemplate, html: string | null): Promise<{ changed: string; templates: DatabaseTemplates }>;
```

- Los campos van como `[[name]]`, las demás etiquetas de Moodle como `##tag##` (`##edit##`, `##more##`, `##user##`…; la página de plantillas las lista).
- `null` restablece la plantilla a la de Moodle por defecto; para `list`, su cabecera y su pie se quedan.
- Devuelve todas las plantillas después.

Lanza `DatabaseError` cuando la base de datos aún no tiene campos, o cuando Moodle no conserva la plantilla: dice que guardó una plantilla de añadir entrada con la etiqueta de un campo dos veces, y conserva la anterior.

## databasePresets

Los preajustes que se le pueden dar a la base de datos: los propios de Moodle (galería de imágenes, diario, propuestas, recursos) y los que otras personas guardaron en el sitio y la persona puede ver.

```ts
function databasePresets(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabasePreset[]>;

interface DatabasePreset {
  id: string;
  name: string;
  description: string;
  userId?: number;
}
```

`id` es lo que recibe `applyDatabasePreset`, el `<user id>/<short name>` de Moodle: `"0/imagegallery"` para los propios de Moodle, sin `userId`.

## applyDatabasePreset

Le da a la base de datos un preajuste, como hacen "Usar este preajuste" y "Aplicar preajuste".

```ts
function applyDatabasePreset(context: BrowserContext, siteUrl: string, activityId: number, presetId: string): Promise<{ changed: string; fields: DatabaseField[] }>;
```

Se añaden los campos del preajuste; un campo con el mismo nombre y tipo que uno del preajuste se conserva, con lo que las entradas tienen en él, y todos los demás campos se eliminan con su contenido. Las plantillas del preajuste sustituyen a las de la base de datos; sus demás ajustes se quedan. Devuelve los campos después. Lanza `MoodleError` (`not-found`) para un preajuste que `databasePresets` no lista.

## Entradas {#entries}

Los servicios de Moodle para las entradas (`mod_data_get_entries`, `mod_data_add_entry`…) son solo para su aplicación móvil: llamados con la sesión de la persona responden `servicenotavailable`. El driver trabaja las entradas con las páginas que usa una persona: la lista (`mod/data/view.php`) las da en su propio orden, búsqueda y paginación; la vista individual de cada entrada da su autor, sus fechas y su aprobación; su formulario de edición (`mod/data/edit.php`) da y recibe sus valores por id de campo, así que funciona en cualquier idioma de la interfaz; `export.php` e `import.php` las mueven como CSV. Todas las funciones lanzan `NotADatabaseError` cuando el id no es una base de datos, `DatabaseError` cuando Moodle se lo niega a la persona (nombrando la capacidad que requiere) y `NotLoggedInError` cuando no hay sesión.

### databaseEntries

Las entradas de una base de datos, en el orden de su lista (el de la persona, o el de la base de datos), con lo que la persona puede ver de cada una.

```ts
function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: DatabaseEntryOptions): Promise<DatabaseEntry[]>;
function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options: DatabaseEntryOptions & { limit: number }): Promise<ListPage<DatabaseEntry>>;

interface DatabaseEntryOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

interface DatabaseEntry {
  id: number;
  author?: { userId: number; name?: string };
  created?: string;
  modified?: string;
  approved: boolean;
  values?: DatabaseEntryField[];
}

interface DatabaseEntryField {
  fieldId: number;
  name?: string;
  value: string | string[] | DatabaseEntryFile[];
}

interface DatabaseEntryFile {
  name: string;
  url?: string;
}
```

- `search`: la búsqueda simple de Moodle, las entradas con ese texto en algún campo o en el nombre de su autor.
- `limit` y `offset`: una página de ellas (consulta [Listas largas](../concepts/calling-functions.md#long-lists)), leída de las páginas de la lista que la contienen, con las entradas por página de la persona.
- `author`, `created`, `modified`, `approved`: de lo que escriben las etiquetas de Moodle en la plantilla individual (`##user##`, `##timeadded##`, `##timemodified##`, `##approvalstatus##` y las acciones de la entrada): las plantillas por defecto de Moodle y sus preajustes las tienen; una plantilla sin ellas los deja fuera. `approved` es false mientras la entrada espera aprobación.
- `values`: el valor de cada campo, leído del formulario de edición de la entrada, así que solo para las entradas que la persona puede editar: todas con `mod/data:manageentries` (los profesores), las suyas para un estudiante mientras Moodle le deje cambiarlas. Un texto corto, un número, una lista desplegable, unos botones de opción, una URL o un área de texto (HTML) son texto; una fecha es `"YYYY-MM-DD"`; las casillas de verificación y una lista de selección múltiple dan sus opciones; las coordenadas son `[latitud, longitud]`, y un campo URL que pide texto del enlace `[url, texto]`; un campo de archivo o de imagen da sus archivos, con la URL que muestra la vista individual. `name` sale de las etiquetas del formulario; un campo de fecha fuera de la plantilla de añadir entrada por defecto de Moodle no tiene.

Las entradas que esperan aprobación solo las ven sus autores y quienes pueden aprobar. La lista de Moodle distingue las entradas por sus enlaces (`##actionsmenu##`, `##more##`, `##moreurl##`): una plantilla de lista sin ninguno de ellos da `DatabaseError`. Cada entrada cuesta dos lecturas de página (su vista individual y su formulario de edición), así que usa `limit` en bases de datos grandes.

### addDatabaseEntry

Añade una entrada con el formulario "Añadir entrada" de la base de datos, como lo haría la persona.

```ts
function addDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, values: DatabaseEntryValues): Promise<{ changed: string; entryId: number }>;

type DatabaseEntryValues = Record<string, DatabaseEntryInput>;
type DatabaseEntryInput = string | number | Date | string[] | number[] | null;
```

- `values`: por id de campo (`"32"`) o por nombre (`"Título"`). Texto o un número para un texto corto, un número, una URL, un área de texto (HTML), una lista desplegable o unos botones de opción; un `Date` o `"YYYY-MM-DD"` para una fecha; las opciones para las casillas de verificación y una lista de selección múltiple; `[latitud, longitud]` para las coordenadas; la ruta absoluta de un archivo local para un campo de archivo o de imagen (sube al área de borrador del campo, como hace el selector de archivos), `null` para dejarlo vacío.
- Los campos que no se dan se quedan como los tiene el formulario: el formulario de un campo de fecha empieza en hoy, y Moodle lo guarda.
- Devuelve el id de la entrada nueva.

Lanza `MoodleError` (`invalid-input`) antes de guardar nada para un campo que el formulario no tiene (nombrando los que tiene) y un valor que no acepta (nombrando lo que ofrece); `DatabaseError` con los mensajes de Moodle cuando rechaza la entrada (un campo obligatorio sin valor…), y cuando se lo niega a la persona: añadir requiere `mod/data:writeentry`, dentro de las fechas de la base de datos y de su límite de entradas. La entrada de alguien que no puede aprobar espera aprobación cuando la base de datos la pide.

### editDatabaseEntry

Cambia una entrada con su formulario de edición: lo que `values` no incluye se queda como está, archivos incluidos.

```ts
function editDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, values: DatabaseEntryValues): Promise<{ changed: string; entryId: number }>;
```

`values` como en `addDatabaseEntry`; el archivo nuevo de un campo de archivo o de imagen sustituye al que tenía. Lanza lo mismo que `addDatabaseEntry`, y `DatabaseError` cuando Moodle no deja a la persona editarla: la entrada de otra persona requiere `mod/data:manageentries`, y los autores cambian las suyas solo mientras Moodle se lo permite (no una vez aprobadas, salvo que la base de datos lo permita).

### deleteDatabaseEntry

Elimina una entrada, como hace su acción Eliminar una vez confirmada: sus valores y sus archivos se van con ella.

```ts
function deleteDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number): Promise<{ changed: string }>;
```

Lanza `DatabaseError` cuando Moodle no la elimina: la base de datos no tiene esa entrada, o la persona no puede (la de otra persona requiere `mod/data:manageentries`; los autores eliminan las suyas mientras Moodle les deje cambiarlas).

### setDatabaseEntryApproved

Aprueba una entrada, o le retira la aprobación, como hacen sus acciones Aprobar y Desaprobar.

```ts
function setDatabaseEntryApproved(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, approved: boolean): Promise<{ changed: string; approved: boolean }>;
```

Lanza `DatabaseError` cuando Moodle no lo hace: a la persona le falta `mod/data:approve`, o la base de datos no tiene esa entrada.

### exportDatabaseEntries

Exporta las entradas a un archivo CSV, como hace la página "Exportar entradas" con una coma entre los valores.

```ts
function exportDatabaseEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, options?: DatabaseExportOptions): Promise<{ file: string; entries: number }>;

interface DatabaseExportOptions {
  userDetails?: boolean;
  times?: boolean;
  approval?: boolean;
}
```

- `file`: una ruta absoluta; un archivo que ya esté ahí se sustituye.
- Una columna por cada campo que Moodle exporta, con el nombre del campo: una fecha como marca de tiempo de Moodle, un campo de imagen o de archivo con el nombre de su archivo (los archivos mismos van solo en el zip de Moodle, que el driver no pide); Moodle añade una columna de etiquetas cuando están activadas.
- `userDetails`: el nombre completo, el nombre de usuario y el correo del autor (requiere `mod/data:exportuserinfo`); `times`: cuándo se añadió y se cambió cada entrada, como escribe Moodle las fechas; `approval`: si cada una está aprobada, para una base de datos que pide aprobación.
- Todas las entradas del grupo de la persona, aprobadas o no. Devuelve el archivo y cuántas entradas tiene.

Lanza `DatabaseError` cuando Moodle niega la exportación: requiere `mod/data:viewalluserpresets` (la capacidad de exportar de Moodle, que tienen los profesores) y una base de datos con campos; y cuando se pide `userDetails` sin `mod/data:exportuserinfo`.

### importDatabaseEntries

Importa entradas de un archivo CSV, como hace la página "Importar entradas".

```ts
function importDatabaseEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, options?: { delimiter?: "comma" | "semicolon" | "tab" | "colon" }): Promise<{ changed: string; added: number }>;
```

- `file`: la ruta absoluta de un CSV en UTF-8 cuya primera fila nombra los campos, como lo escribe `exportDatabaseEntries`. Moodle toma o se salta las columnas de usuario, fechas, aprobación y etiquetas de su propia exportación: una columna `Username` hace autor a ese usuario, una columna `Approved` fija la aprobación.
- `delimiter`: entre los valores, una coma salvo que se indique otro.
- Devuelve cuántas entradas añadió Moodle.

Lanza `DatabaseError` cuando Moodle se lo niega a la persona (requiere `mod/data:manageentries`) o rechaza el archivo (una columna que no es un campo…, con el mensaje de Moodle).

## Ejemplo {#example}

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const activityId = 52;

await moodle.addDatabaseField(activityId, { type: "text", name: "Título", required: true });
await moodle.addDatabaseField(activityId, { type: "menu", name: "Color", options: { choices: ["Rojo", "Azul"] } });
await moodle.addDatabaseField(activityId, { type: "date", name: "Visto el" });
const { fields } = await moodle.addDatabaseField(activityId, { type: "picture", name: "Foto", options: { width: 320, listWidth: 80 } });
console.log(fields.map((f) => `${f.id} ${f.name} (${f.type})`).join("\n"));

await moodle.setDatabaseTemplate(activityId, "list", '<div class="entry">[[Título]]: [[Color]], [[Visto el]] [[Foto]] ##more##</div>');
const templates = await moodle.databaseTemplates(activityId);
console.log(templates.single);

const { entryId } = await moodle.addDatabaseEntry(activityId, { Título: "Un petirrojo", Color: "Rojo", "Visto el": "2026-10-17", Foto: "/home/ana/petirrojo.jpg" });
await moodle.setDatabaseEntryApproved(activityId, entryId, true);
for (const entry of await moodle.databaseEntries(activityId, { search: "petirrojo" })) {
  console.log(entry.id, entry.author?.name, entry.approved, entry.values?.map((v) => `${v.name}: ${JSON.stringify(v.value)}`).join(", "));
}
await moodle.exportDatabaseEntries(activityId, "/home/ana/avistamientos.csv", { times: true });
```

## Categorías de datos {#data-categories}

Las funciones de configuración son `course-content`: `databaseFields`, `addDatabaseField`, `editDatabaseField`, `deleteDatabaseField`, `databaseTemplates`, `setDatabaseTemplate`, `databasePresets` y `applyDatabasePreset`. Eliminar un campo, o aplicar un preajuste, elimina también lo que las entradas tenían en los campos que se van. De las entradas: `databaseEntries` y `exportDatabaseEntries` son `others-personal` (las entradas de otros, y sus nombres); `addDatabaseEntry` es `course-content`; `editDatabaseEntry`, `deleteDatabaseEntry`, `setDatabaseEntryApproved` e `importDatabaseEntries` son `course-content` y `others-write` (la entrada de otra persona, o entradas a nombre de otros). Consulta [Categorías de datos](../concepts/data-categories.md).

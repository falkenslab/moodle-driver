# Bases de datos

Actividades de base de datos (módulo `data`), tal como las configura un profesor: sus campos (uno por cada tipo de dato que guarda una entrada), sus plantillas (cómo se listan, se muestran, se añaden y se buscan las entradas) y los preajustes del sitio, que le dan ambas cosas a la vez. La base de datos en sí se crea con `createActivity({ type: "data", … })` (consulta [Actividades y secciones](activities.md)); sus entradas las añaden los participantes con el propio formulario de Moodle, y se valoran con `rate` (consulta [Calificación](grading.md#rate)).

**Términos:** [base de datos](../reference/glossary.md#database), [id del módulo del curso](../reference/glossary.md#course-module-id).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

Moodle no abre a AJAX la configuración de una base de datos: todo pasa por sus páginas de campos, plantillas y preajustes (`mod/data/field.php`, `templates.php`, `preset.php`), leídas por los nombres de sus campos, los enlaces de la tabla de campos y sus iconos, así que funciona en cualquier idioma de la interfaz. Requieren la capacidad de Moodle `mod/data:managetemplates`, que tienen los profesores. Todas las funciones lanzan `NotADatabaseError` cuando el id no es una base de datos, `DatabaseError` cuando Moodle niega a la persona su configuración (con el mensaje de Moodle) y `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

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
```

## Categorías de datos {#data-categories}

Todas las funciones de aquí son `course-content`: `databaseFields`, `addDatabaseField`, `editDatabaseField`, `deleteDatabaseField`, `databaseTemplates`, `setDatabaseTemplate`, `databasePresets` y `applyDatabasePreset`. Eliminar un campo, o aplicar un preajuste, elimina también lo que las entradas tenían en los campos que se van. Consulta [Categorías de datos](../concepts/data-categories.md).

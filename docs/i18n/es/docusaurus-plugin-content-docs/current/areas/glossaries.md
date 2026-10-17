# Glosarios

Actividades de glosario (módulo `glossary`), tal como las usan los participantes y los profesores: sus entradas leídas, añadidas, cambiadas, eliminadas y aprobadas, sus categorías, y sus entradas exportadas al XML de Moodle e importadas desde él. El glosario en sí se crea con `createActivity({ type: "glossary", … })` (consulta [Actividades y secciones](activities.md)), con sus ajustes por los nombres de su formulario (`defaultapproval: 0` para que las entradas esperen la aprobación de un profesor, `displayformat`, `entbypage`…); sus entradas se valoran con `rate` (consulta [Calificación](grading.md#rate)).

**Términos:** [glosario](../reference/glossary.md#glossary-activity), [id del módulo del curso](../reference/glossary.md#course-module-id).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

De los servicios de glosario de Moodle solo está abierto a AJAX el que lee una entrada (los demás son de la aplicación móvil): el driver lista las entradas desde la página del glosario, lee cada una con ese servicio, y escribe mediante las propias páginas del glosario, el formulario de la entrada, la confirmación de eliminar, los enlaces de aprobación y las páginas de categorías, exportación e importación, leídas por sus enlaces, campos y datos, así que funciona en cualquier idioma de la interfaz. Todas las funciones lanzan `NotAGlossaryError` cuando el id no es un glosario que la persona pueda abrir, `GlossaryError` cuando Moodle lo rechaza (con el mensaje de Moodle y la capacidad que requiere) y `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## glossaryEntries

Las entradas de un glosario, en el orden del glosario (por concepto), cada una leída entera.

```ts
function glossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: GlossaryEntryOptions): Promise<GlossaryEntry[]>;

interface GlossaryEntryOptions {
  letter?: string;
  search?: string;
  pending?: boolean;
  limit?: number;
  offset?: number;
}

interface GlossaryEntry {
  id: number;
  concept: string;
  definition: string;
  aliases: string[];
  categoryIds?: number[];
  authorId: number;
  authorName: string;
  approved: boolean;
  attachments: GlossaryAttachment[];
  created?: string;
  modified?: string;
}

interface GlossaryAttachment {
  name: string;
  url: string;
  size: number;
  mimeType?: string;
}
```

- Lo que ve la persona, como en la página del glosario: las entradas aprobadas y las suyas que esperan aprobación. Un profesor no ve ahí la entrada de un estudiante que espera: `pending: true` lista en su lugar las entradas que esperan aprobación, desde la página de aprobación, que requiere la capacidad de Moodle `mod/glossary:approve` (la tienen los profesores).
- `letter`: las entradas cuyo concepto empieza por ella (un carácter); `search`: las entradas cuyo concepto, alias o definición contienen las palabras, como hace la búsqueda del glosario con "Buscar en el texto completo" marcado; no va ni con `letter` ni con `pending`.
- `definition`: HTML, con las URL de sus imágenes en el sitio; las URL de `attachments` se descargan con `downloadFile` (consulta [Archivos](files.md)).
- `aliases`: las otras palabras de la entrada (las "Palabra(s) clave" de Moodle), tal como las muestra la página del glosario; el formato de visualización "Lista de entradas" no muestra ninguna, así que allí vienen vacías.
- `categoryIds`: las categorías en las que está la entrada, leídas de la vista por categorías del glosario. El formato de visualización por defecto de Moodle, "Simple, estilo diccionario", no tiene vista por categorías, así que allí `categoryIds` se omite.
- `limit` y `offset` paginan la lista como cualquier lista larga (consulta [Listas largas](../concepts/calling-functions.md#long-lists)), leyendo solo las páginas de Moodle que necesita la ventana.
- Se omite una entrada para la que la página no da id: la entrada propia de un estudiante que espera aprobación, una vez acabado su tiempo de edición en Moodle, no tiene ningún enlace que la nombre.

## addGlossaryEntry

Añade una entrada como la persona, mediante el formulario de entrada de Moodle.

```ts
function addGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, input: GlossaryEntryInput): Promise<GlossaryEntryChange>;

interface GlossaryEntryInput {
  concept: string;
  definition: string;
  aliases?: string[];
  categoryIds?: number[];
  attachments?: string[];
  embed?: string[];
}

interface GlossaryEntryChange {
  changed: string;
  entryId: number;
  entry?: GlossaryEntry;
}
```

- `definition`: HTML; con `embed`, los archivos locales (rutas absolutas) que el HTML nombra por su nombre de archivo (`<img src="shot.png">`) se suben en él, como los incrusta [`createActivity`](activities.md).
- `attachments`: archivos locales (rutas absolutas) adjuntos a la entrada.
- `categoryIds`: ids de `glossaryCategories`.
- Devuelve el id de la entrada y la entrada tal como la lee `glossaryEntries`. La entrada de un estudiante espera aprobación cuando el glosario la pide (`changed` lo dice); la de un profesor queda aprobada al momento.

Lanza `GlossaryError` cuando el glosario no acepta entradas de la persona (requiere `mod/glossary:write`, que tienen estudiantes y profesores salvo que los permisos del glosario se la quiten) o una categoría no es del glosario, y `FormError` con los motivos de Moodle cuando rechaza la entrada (su concepto ya está, y el glosario no admite duplicados).

## editGlossaryEntry

Cambia una entrada mediante su formulario: solo lo que se indica.

```ts
function editGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, changes: GlossaryEntryChanges): Promise<GlossaryEntryChange>;

type GlossaryEntryChanges = Partial<GlossaryEntryInput>;
```

- `attachments` sustituye los adjuntos de la entrada; `[]` los quita. `categoryIds: []` la saca de todas las categorías.
- Un estudiante cambia sus propias entradas mientras dura el tiempo de edición de Moodle (el "tiempo máximo para editar mensajes" del sitio, 30 minutos por defecto), o siempre si el glosario lo permite; un profesor (`mod/glossary:manageentries`) cambia las de cualquiera.
- Una entrada guardada por alguien que puede aprobarla queda aprobada, como la guarda Moodle.

Lanza `GlossaryError` con el motivo cuando Moodle lo rechaza: la entrada es de otra persona, se acabó el tiempo de edición, no existe esa entrada en el glosario.

## deleteGlossaryEntry

Elimina una entrada con sus archivos, como hace su enlace de eliminar tras la confirmación de Moodle; quién puede hacerlo es como en `editGlossaryEntry`.

```ts
function deleteGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number): Promise<GlossaryEntryChange>;
```

## setGlossaryEntryApproved

Aprueba una entrada que espera aprobación, o retira una aprobación, como hacen el enlace de aprobar de la página de aprobación y el "Deshacer la aprobación" de la entrada.

```ts
function setGlossaryEntryApproved(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, approved: boolean): Promise<GlossaryEntryChange>;
```

Una entrada a la que se le retira la aprobación vuelve a esperar, visible solo para su autor y para quien puede aprobarla. Lanza `GlossaryError` cuando la persona no puede aprobar (`mod/glossary:approve`) o el glosario no le muestra esa entrada.

## glossaryCategories

Las categorías de un glosario, por id y nombre, ordenadas por nombre.

```ts
function glossaryCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<GlossaryCategory[]>;

interface GlossaryCategory {
  id: number;
  name: string;
}
```

Se leen de la vista por categorías del glosario o, cuando su formato de visualización no la tiene, del formulario de entrada, que también las lista: `GlossaryError` cuando la persona tampoco puede añadir entradas ahí.

## addGlossaryCategory

Añade una categoría, como hace la página de categorías del glosario.

```ts
function addGlossaryCategory(context: BrowserContext, siteUrl: string, activityId: number, category: { name: string; autoLink?: boolean }): Promise<GlossaryCategoryChange>;

interface GlossaryCategoryChange {
  changed: string;
  categoryId: number;
  categories: GlossaryCategory[];
}
```

Con `autoLink`, Moodle enlaza el nombre de la categoría allí donde aparece en el curso, como enlaza las entradas. Lanza `GlossaryError` cuando la persona no puede gestionar las categorías (`mod/glossary:managecategories`, que tienen los profesores) o ya hay una con ese nombre (Moodle compara los nombres sin distinguir mayúsculas).

## exportGlossaryEntries

Guarda las entradas aprobadas de un glosario en el XML de Moodle, con sus alias, categorías y archivos, como hace "Exportar entradas" del glosario; Moodle deja fuera las entradas que esperan aprobación.

```ts
function exportGlossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options: { destDir: string }): Promise<DownloadedFile>;
```

`destDir` es una carpeta absoluta; el archivo se guarda allí con un nombre libre, sin sobrescribir nunca otro, y se devuelve como devuelve los archivos `downloadFile`. Requiere `mod/glossary:export`, que tienen los profesores.

## importGlossaryEntries

Importa en el glosario las entradas de un XML de Moodle (tal como lo guarda `exportGlossaryEntries`), mediante su formulario de importación.

```ts
function importGlossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, options?: { categories?: boolean }): Promise<GlossaryImport>;

interface GlossaryImport {
  changed: string;
  total: number;
  imported: number;
  rejected: number;
  categoriesAdded?: number;
}
```

- Las entradas entran como de la persona, aprobadas; con `categories`, también sus categorías, que se añaden cuando el glosario no las tiene (`categoriesAdded` las cuenta).
- Moodle rechaza una entrada cuyo concepto ya está (cuando el glosario no admite duplicados) o que no tiene concepto o definición: `rejected` las cuenta.
- Requiere `mod/glossary:import`, que tienen los profesores; `GlossaryError` cuando Moodle no puede leer el archivo.

## Ejemplo {#example}

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const activityId = 61;

const { categoryId } = await moodle.addGlossaryCategory(activityId, { name: "Redes" });
const { entryId } = await moodle.addGlossaryEntry(activityId, {
  concept: "Router",
  definition: "<p>Un dispositivo que reenvía paquetes entre redes.</p>",
  aliases: ["encaminador"],
  categoryIds: [categoryId],
});
console.log(`Entrada ${entryId} añadida`);

// Las entradas de los estudiantes que esperan aprobación, aprobadas una a una.
for (const entry of await moodle.glossaryEntries(activityId, { pending: true })) {
  console.log(`${entry.concept}, de ${entry.authorName}`);
  await moodle.setGlossaryEntryApproved(activityId, entry.id, true);
}
```

## Categorías de datos {#data-categories}

`glossaryEntries` y `exportGlossaryEntries` son `course-content` y `others-personal` (las entradas llevan a sus autores y a menudo son trabajo de los estudiantes); `addGlossaryEntry`, `glossaryCategories`, `addGlossaryCategory` e `importGlossaryEntries` son `course-content`; `editGlossaryEntry`, `deleteGlossaryEntry` y `setGlossaryEntryApproved` son `course-content` y `others-write`, porque con ellas un profesor cambia, elimina o aprueba la entrada de otra persona. Consulta [Categorías de datos](../concepts/data-categories.md).

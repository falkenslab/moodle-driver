# Actividades y secciones

Construir un curso: crear actividades y recursos de cualquier tipo mediante el propio formulario de actividad de Moodle, leer y cambiar sus ajustes, y renombrar, describir, mostrar, ocultar, mover, duplicar y borrar actividades y secciones como hace el editor de la página del curso. Es para profesores con permiso de edición (`moodle/course:manageactivities` de Moodle); a cualquier otra persona, Moodle se lo rechaza. Cada cambio devuelve después la estructura del curso, para que un programa pueda comprobar lo ocurrido sin otra llamada.

**Términos:** [sección](../reference/glossary.md#section), [actividad](../reference/glossary.md#activity), [módulo](../reference/glossary.md#module), [id del módulo del curso](../reference/glossary.md#course-module-id), [id de instancia](../reference/glossary.md#instance-id), [changed](../reference/glossary.md#changed).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## Qué devuelve un cambio {#what-a-change-returns}

Todas las funciones de esta página salvo `activitySettings` y `courseActivityTypes` devuelven un `CourseChange`:

- `changed`: una frase que dice lo que se hizo (`Created page 812 "Loops" in section 2.`).
- `activityId`: la actividad creada, actualizada o duplicada (la copia), cuando la hay.
- `sectionId`: la sección añadida, en `addSection`.
- `url`: la página de la actividad, tras crearla o actualizarla.
- `files`: los archivos de un recurso de archivo o de una carpeta, después de que `updateActivity` los cambie (`DraftFile[]`, `{ name, size }`).
- `sections`: las `CourseSection[]` del curso tras el cambio, tal como las da [courseStructure](courses.md) (sin detalles).

## createActivity

Crea una actividad o un recurso de cualquier tipo al final de una sección, mediante `course/modedit.php`, y lo guarda con "Guardar cambios y regresar al curso".

```ts
function createActivity(
  context: BrowserContext,
  siteUrl: string,
  input: ActivityFields & { courseId: number; sectionId: number; type: string; files?: (string | DraftUpload)[] },
): Promise<CourseChange>;

interface ActivityFields {
  name?: string;
  description?: string; // HTML
  content?: string; // HTML: el contenido de una página o el texto de un área de texto y medios
  url?: string; // el destino de un recurso URL
  visibility?: "shown" | "hidden" | "stealth"; // ACTIVITY_VISIBILITIES
  restrictions?: Restrictions; // cuándo pueden abrirla los estudiantes
  completion?: Completion; // cuándo cuenta como finalizada
  settings?: Record<string, FieldValue>;
  embed?: string[]; // archivos locales que nombra el HTML: <img src="shot.png">
}
```

- `courseId`, `sectionId`: el curso y el id de la sección (no su número), de la estructura del curso.
- `type`: el nombre del módulo (`"page"`, `"assign"`, `"quiz"`, `"url"`, `"resource"`, `"folder"`, `"label"`…); `courseActivityTypes` lista lo que la persona puede añadir.
- `name`, `description`: el nombre y la descripción de la actividad (que se muestra en su página).
- `content`: el contenido de una página (`page[text]`) o el texto de un área de texto y medios (`introeditor[text]`); en cualquier otro tipo es un error.
- `url`: el destino de un recurso URL (`externalurl`).
- `visibility`: `"hidden"` por defecto, para que el profesor la publique después de revisarla; `"stealth"` la oculta de la página del curso pero la mantiene disponible por enlace, donde el sitio lo permite.
- `restrictions`, `completion`: cuándo pueden abrirla los estudiantes y cuándo cuenta como finalizada, en términos sencillos (consulta [Restricciones y finalización](#restrictions-and-completion)).
- `settings`: cualquier otro campo del formulario por su nombre en el formulario, como `{ "duedate[enabled]": true, "duedate[day]": 23 }` o `{ completion: 1 }`. Se rellenan después de las entradas comunes, en el orden indicado, y prevalecen sobre ellas para el mismo campo.
- `files`: rutas locales absolutas que se suben al área de archivos del formulario, en un recurso de archivo o una carpeta (consulta [archivos](files.md)); una actividad SCORM o H5P (`h5pactivity`) toma el primero como su paquete (consulta [SCORM](scorm.md) y [H5P](h5p.md)). Un `{ from, to }` (`DraftUpload`) da a un archivo otro nombre o lo pone en una subcarpeta de una carpeta: `{ from: "/home/ada/notes.pdf", to: "week1/notes.pdf" }`.
- `embed`: rutas locales absolutas de imágenes y archivos que poner dentro del HTML de `description`, `content` o un editor de `settings` (`"activityeditor[text]"`), que nombra cada uno por su nombre de archivo: `content: '<img src="shot.png">', embed: ["/home/ada/shot.png"]`. Se suben al área de borrador propia de ese editor, como inserta una imagen el editor de Moodle, y se guardan con el texto (consulta [Insertar archivos en texto enriquecido](files.md#embedding-files-in-rich-text)).

`activityId` es el id de la nueva actividad, que se encuentra comparando el curso antes y después (en un banco de preguntas compartido, `qbank`, que nunca aparece en la página del curso, comparando los bancos de preguntas del curso); cuando no aparece ninguna actividad nueva, `changed` lo dice y `activityId` es undefined.

Errores:

- Un `MoodleError` cuando una ruta de archivo no es absoluta o no existe (`invalid-input`, `not-found`), cuando un archivo que insertar y el HTML no coinciden (`invalid-input`), cuando el curso no tiene ninguna sección con ese id (`not-found`), cuando se indica `content` para un tipo que no es una página ni un área de texto y medios (`invalid-input`), o cuando el formulario del tipo no admite archivos (`not-available`).
- `FormError` cuando un campo no está en el formulario o está deshabilitado (ver más abajo), cuando falla la subida, o cuando Moodle rechaza el formulario; sus `fields` contienen el mensaje de Moodle de cada campo (`{ field: "name", message: "Debe suministrar un valor aquí." }`).
- `NotLoggedInError` sin sesión.

## updateActivity

Cambia una actividad existente mediante su formulario: solo cambia lo que se indica, y los archivos que ya hay se quedan salvo que `files` diga otra cosa.

```ts
function updateActivity(context: BrowserContext, siteUrl: string, activityId: number, input: ActivityFields & { files?: FileChanges }): Promise<CourseChange>;

interface FileChanges {
  add?: (string | DraftUpload)[]; // rutas locales, o { from, to } para otro nombre o una subcarpeta
  remove?: string[]; // archivos por su ruta en la actividad: "notes.pdf", "week1/notes.pdf"
  replace?: (string | DraftUpload)[]; // el nuevo conjunto completo
}
```

Recibe los mismos `ActivityFields` que `createActivity`, y lee el módulo y el curso de la actividad del formulario. Los errores son los mismos casos de `FormError`, y un `MoodleError` (`invalid-input`) por `content` en un tipo que no es una página ni un área de texto y medios.

### Cambiar los archivos de un recurso o de una carpeta {#changing-a-resources-or-folders-files}

`files` cambia los archivos de un recurso de archivo o de una carpeta (también el paquete de un SCORM o de una actividad H5P) en el área de borrador del formulario antes de guardarlo, como hace el gestor de archivos: `remove` borra archivos por su ruta en la actividad, tal como los lista `activitySettings`; `add` sube archivos locales, y un archivo con el nombre de uno que ya existe lo sustituye (una nueva versión de un PDF conserva su nombre y sus enlaces); `replace` quita todos los archivos y sube los indicados. Las carpetas dentro de una carpeta son rutas: `"week1/notes.pdf"`, que se crean cuando un archivo va ahí. Los `files` del resultado son los archivos de la actividad después del cambio, y `changed` dice qué se quitó y qué se añadió.

- Un archivo que quitar y que la actividad no tiene: un `MoodleError` (`not-found`) que nombra los archivos que tiene, antes de guardar nada.
- `replace` con `add` o `remove`: un `MoodleError` (`invalid-input`).
- Un tipo cuyo formulario no tiene archivos (una página, un cuestionario): un `MoodleError` (`not-available`).

```ts fragment
// Una nueva versión del enunciado, y una carpeta que pierde un archivo y gana otro en una subcarpeta.
await moodle.updateActivity(812, { files: { add: ["/home/ada/brief.pdf"] } });
await moodle.updateActivity(815, { files: { remove: ["old-notes.pdf"], add: [{ from: "/home/ada/notes.pdf", to: "week1/notes.pdf" }] } });
```

## activitySettings

Los ajustes de una actividad tal como los tiene su formulario, sin enviarlo: lo que un programa lee antes de llamar a `updateActivity`.

```ts
function activitySettings(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<{
  id: number;
  module: string;
  courseId: number;
  name: string;
  description: string;
  fields: FormField[];
  files?: DraftFile[];
  restrictions?: Restrictions;
  completion?: Completion;
}>;

interface FormField {
  name: string;
  type: "text" | "textarea" | "select" | "checkbox" | "radio" | "number" | "date" | "other";
  label?: string;
  value?: string | string[];
  checked?: boolean;
  options?: { value: string; label: string }[];
  disabled?: boolean;
}
```

`description` es el HTML del editor de la descripción. `files`, en un recurso de archivo, una carpeta, un SCORM o una actividad H5P (su paquete), son sus archivos como `{ name, size }`: `name` es la ruta en la actividad (`"week1/notes.pdf"`), tal como la recibe `files.remove` de `updateActivity`, y `size` va en bytes. `restrictions` (undefined si no hay ninguna) y `completion` (undefined cuando la finalización está desactivada en el curso) vienen en los términos que recibe `updateActivity` (consulta [Restricciones y finalización](#restrictions-and-completion)). Cada campo de `fields` tiene:

- `name`: el nombre en el formulario que recibe `settings`.
- `type`: las partes de un selector de fecha (`duedate[day]`, `[month]`, `[year]`, `[hour]`, `[minute]`) son `"date"`; las entradas de texto, URL y correo electrónico son `"text"`; cualquier otra cosa no reconocida es `"other"`.
- `label`: tal como lo muestra el formulario, en el idioma del sitio; una parte de una fecha se nombra según su fila (`"Fecha de entrega (día)"`).
- `value`: el texto, la opción seleccionada (un array en un select múltiple) o el valor del radio marcado; incluido el HTML de los editores.
- `checked`: en una casilla de verificación.
- `options`: en un select o un grupo de radios.
- `disabled`: presente (`true`) cuando Moodle tiene el campo deshabilitado hasta que otro lo habilite.

Se omiten los campos internos (la sesskey, ids, botones, campos ocultos), y también las claves sin valor.

### Campos deshabilitados {#disabled-fields}

Moodle deshabilita algunos campos hasta que otro los habilita: una fecha hasta que se marca su casilla "Habilitar", una calificación máxima hasta que se elige "Reescalar calificaciones existentes" cuando ya hay calificaciones. Moodle no envía un campo deshabilitado, así que el cambio se perdería: `createActivity`, `updateActivity` y todos los formularios que rellena el driver lanzan `FormError` cuando se rellena un campo que sigue deshabilitado. Los campos se rellenan de uno en uno en el orden indicado, así que pon primero el campo que habilita en la misma llamada, como en `{ "grade[modgrade_rescalegrades]": "no", "grade[modgrade_point]": 20 }`.

`activitySettings` lanza `ActivitySettingsError` cuando no hay formulario que leer (no es una actividad, o la persona no puede editarla), con el propio motivo de Moodle cuando su página de error da uno (`Sorry, no permission (Manage activities).`).

## Restricciones y finalización {#restrictions-and-completion}

`createActivity` y `updateActivity` reciben cuándo está disponible una actividad (`restrictions`) y cuándo cuenta como finalizada (`completion`) en términos sencillos, y construyen a partir de ellos los campos de Moodle: el árbol de disponibilidad que su formulario guarda como JSON (`availabilityconditionsjson`), y los campos de finalización del módulo. `editSection` recibe `restrictions` para una sección. `activitySettings` devuelve ambos en los mismos términos.

```ts
interface Restrictions {
  conditions: Restriction[]; // [] quita todas las restricciones
  match?: "all" | "any"; // "all" por defecto
  hidden?: boolean; // mientras no se cumplan: oculta a los estudiantes, o (false, el valor por defecto) mostrada en gris con las condiciones
}

type Restriction =
  | { type: "date"; from?: Date | string; until?: Date | string } // fechas ISO; from, until o ambas
  | { type: "grade"; activityId: number; min?: number; max?: number } // porcentajes de su calificación máxima
  | { type: "completion"; activityId: number; state: CompletionState } // "complete", "incomplete", "complete-pass", "complete-fail"
  | { type: "group"; groupId: number }
  | { type: "other"; json: unknown }; // una condición para la que el driver no tiene términos, tal como la guarda Moodle

type Completion = "none" | "manual" | { view?: boolean; grade?: boolean; passGrade?: boolean; submit?: boolean; expected?: Date | string };
```

Restricciones:

- Una condición de fecha con `from` y `until` es un único intervalo: deben cumplirse ambas, diga lo que diga `match` de las demás. `from` es "desde" en Moodle (`>=`) y `until` es "hasta" (`<`).
- Una condición de calificación nombra la actividad; la de Moodle nombra su elemento de calificación, que el driver busca en la página de configuración del libro de calificaciones del curso (una actividad con varios elementos de calificación, como la calificación de foro completo de un foro y sus valoraciones, toma el primero). `min` y `max` son porcentajes, como en el formulario de Moodle (`min: 50` es al menos la mitad de la calificación máxima). Una actividad sin elemento de calificación es un `MoodleError` (`not-found`).
- `hidden: true` oculta la actividad o la sección a los estudiantes que no cumplen las condiciones; si no, la página del curso la muestra en gris con las condiciones (el icono del ojo de Moodle).
- Al leerla, una condición para la que el driver no tiene términos (un agrupamiento, un campo del perfil de usuario, un conjunto anidado, un conjunto "no debe") viene como `{ type: "other", json }`, el propio nodo de Moodle, y se vuelve a escribir tal cual; igual que una condición de calificación cuyo elemento de calificación el driver no puede asociar a una actividad.
- Moodle guarda sin quejarse una condición sobre un grupo que el curso no tiene, así que toma los ids de grupo de los grupos del curso ([participantes y grupos](participants.md)); la actividad de una condición de finalización se comprueba antes contra el curso (un `MoodleError`, `not-found`). Un árbol que Moodle rechaza al guardar el formulario es un `FormError` con su mensaje en `availabilityconditionsjson`.

Finalización:

- `"none"`: sin seguimiento; `"manual"`: los estudiantes la marcan como hecha ([setCompletion](completion.md#setcompletion)).
- Un objeto: finalizada al cumplir sus condiciones, todas ellas: `view` (verla), `grade` (recibir una calificación), `passGrade` (una calificación de aprobado; implica `grade`, y la actividad necesita una calificación para aprobar, o Moodle rechaza el formulario), `submit` (entregar: tareas y consultas). `expected` es la fecha que se muestra a los estudiantes como la prevista, no una condición. Las condiciones no indicadas se desactivan.
- Una condición que el formulario del módulo no tiene (`submit` en una página) es un `MoodleError` (`invalid-input`) que la nombra, antes de guardar nada; un formulario sin ajustes de finalización (finalización desactivada en el curso o en el sitio) es un `MoodleError` (`not-available`).
- Las demás condiciones del módulo (el número de mensajes de un foro, los intentos de un cuestionario) quedan como están: ponlas mediante `settings` por los nombres de su formulario (`activitySettings` las lista). `settings` se rellena al final y prevalece sobre `completion` y `restrictions` para el mismo campo.
- Cuando los estudiantes ya han finalizado la actividad, Moodle bloquea sus ajustes de finalización: cambiarlos entonces es un `FormError` por campos deshabilitados.

```ts fragment
// Una página que se finaliza al verla, y un cuestionario abierto solo a quienes la hayan finalizado, a partir del lunes.
const intro = await moodle.createActivity({ courseId: 3, sectionId: 12, type: "page", name: "Lee esto primero", content: "<p>…</p>", completion: { view: true } });
await moodle.updateActivity(41, {
  restrictions: { conditions: [{ type: "completion", activityId: intro.activityId!, state: "complete" }, { type: "date", from: "2026-10-19T08:00:00Z" }] },
  completion: { grade: true, passGrade: true },
});
console.log((await moodle.activitySettings(41)).restrictions);
```

## Reordenar {#reordering}

Las actividades y las secciones se mueven con `editActivity` y `editSection`, como hace "Mover" en la página del curso:

- `editActivity(courseId, activityId, { beforeActivityId })` pone la actividad justo antes de otra, en la sección de esa otra.
- `editActivity(courseId, activityId, { sectionId })` la pone al final de una sección.
- `editSection(courseId, sectionId, { afterSectionId })` pone la sección justo después de otra.

Los ids salen de la estructura del curso (el `id` de una sección, no su `number`), y cada llamada devuelve la estructura después del cambio, para que un programa pueda comprobar el nuevo orden.

```ts fragment
// El curso 3 tiene General (sección 10), Unidad 1 (11) con Intro (21) y Tarea (22), Unidad 2 (12) con Cuestionario (23).
await moodle.editActivity(3, 23, { beforeActivityId: 21 }); // Unidad 1: [Cuestionario, Intro, Tarea]
await moodle.editActivity(3, 21, { sectionId: 12 }); // Intro al final de la Unidad 2
const after = await moodle.editSection(3, 12, { afterSectionId: 10 }); // Unidad 2 antes de la Unidad 1
console.log(after.sections.map((s) => `${s.title}: ${s.activities.map((a) => a.name).join(", ")}`));
```

## editActivity

Renombra, muestra u oculta, o mueve una actividad, mediante los servicios del editor del curso (`core_update_inplace_editable`, `core_courseformat_update_course`).

```ts
function editActivity(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  activityId: number,
  changes: { name?: string; visibility?: ActivityVisibility; sectionId?: number; beforeActivityId?: number },
): Promise<CourseChange>;
```

`sectionId` mueve la actividad al final de esa sección; `beforeActivityId` la mueve antes de esa actividad. Cada cambio indicado se hace por turno (renombrar, luego la visibilidad, luego mover); sin ninguno, `changed` es `"Nothing to change."`.

## duplicateActivity y deleteActivity {#duplicateactivity-and-deleteactivity}

```ts
function duplicateActivity(context: BrowserContext, siteUrl: string, courseId: number, activityId: number): Promise<CourseChange>;
function deleteActivity(context: BrowserContext, siteUrl: string, courseId: number, activityId: number): Promise<CourseChange>;
```

`duplicateActivity` hace una copia como hace "Duplicar" en la página del curso (Moodle la coloca justo después de la original y la nombra con "(copia)"); `activityId` es el id de la copia. `deleteActivity` borra la actividad, con los datos de sus participantes (entregas, mensajes, intentos).

## addSection, editSection y deleteSection {#addsection-editsection-and-deletesection}

```ts
function addSection(context: BrowserContext, siteUrl: string, courseId: number, options?: { name?: string; afterSectionId?: number; summary?: string; embed?: string[] }): Promise<CourseChange>;
function editSection(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  sectionId: number,
  changes: { name?: string; visible?: boolean; summary?: string; restrictions?: Restrictions; afterSectionId?: number; embed?: string[] },
): Promise<CourseChange>;
function deleteSection(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number): Promise<CourseChange>;
```

- `addSection` añade una sección después de `afterSectionId`, o al final si no se indica; con `name` la renombra después, y con `summary` le da una descripción. `sectionId` es el id de la nueva sección.
- `editSection` la renombra, la describe (`summary`), la restringe (`restrictions`, consulta [Restricciones y finalización](#restrictions-and-completion)), la muestra (`visible: true`) o la oculta, o la mueve después de otra sección.
- `summary` es la descripción de la sección, HTML tal como se indica (`""` la quita), que se muestra en la página del curso bajo el nombre de la sección. Ningún servicio la cambia, ni tampoco `restrictions`, así que se guardan mediante el propio formulario de la sección (`course/editsection.php`, sus `summary_editor` y `availabilityconditionsjson`), en un solo guardado cuando se indican ambos; el driver solo acepta una sección del curso indicado: la de otro curso es un `MoodleError` (`not-found`), y los rechazos del formulario por parte de Moodle, un `FormError`. [courseStructure](courses.md) con `details` la lee como `summary`.
- `embed`: rutas locales absolutas de imágenes y archivos que nombra `summary` (`<img src="map.png">`), que se insertan en él como hace el editor de Moodle (consulta [Insertar archivos en texto enriquecido](files.md#embedding-files-in-rich-text)).
- `deleteSection` borra la sección y todas las actividades que contiene, con los datos de sus participantes.

Las secciones se renombran mediante el editor en línea del formato del curso (`format_topics`, `format_weeks`…): el driver lee una vez el formato del curso de las clases de la página del curso y lo guarda para el resto del proceso.

## Errores del editor del curso {#errors-of-the-course-editor}

Las funciones de edición (`editActivity`, `duplicateActivity`, `deleteActivity`, `addSection`, `editSection`, `deleteSection`) transmiten los rechazos de Moodle como `MoodleServiceError`, con su `errorcode`: una actividad o sección que el curso no tiene es `invalidrecord`, y una persona sin permiso para editar el curso recibe el propio rechazo de Moodle de la misma forma. Sin sesión es `NotLoggedInError`.

## courseActivityTypes

Los tipos de actividad y de recurso que la persona puede añadir a un curso, de `core_course_get_course_content_items`.

```ts
function courseActivityTypes(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ type: string; title: string; purpose?: string }[]>;
```

`type` es lo que recibe `createActivity`, `title` el nombre que muestra el selector de actividades (en el idioma del sitio) y `purpose` la agrupación de Moodle (`"content"`, `"assessment"`, `"collaboration"`…) cuando la da. Un tipo con varios elementos (herramientas externas) aparece una sola vez. Quien no puede editar el curso recibe una lista vacía.

## Ejemplo {#example}

```ts

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

const unit = await moodle.addSection(3, { name: "Unidad 4: Recursividad" });
const sectionId = unit.sectionId!;

const page = await moodle.createActivity({
  courseId: 3,
  sectionId,
  type: "page",
  name: "Qué es la recursividad",
  content: "<p>Una función que se llama a sí misma, con un caso base.</p>",
});

const assignment = await moodle.createActivity({
  courseId: 3,
  sectionId,
  type: "assign",
  name: "Factorial recursivo",
  description: "<p>Escribe <code>factorial(n)</code> de forma recursiva y sube el archivo.</p>",
  settings: { "duedate[enabled]": true, "duedate[day]": 30, "duedate[month]": 10, "duedate[year]": 2026, assignsubmission_file_enabled: true },
});

// Comprueba los ajustes por nombre antes de cambiarlos.
const settings = await moodle.activitySettings(assignment.activityId!);
console.log(settings.fields.filter((f) => f.disabled).map((f) => f.name));

await moodle.updateActivity(assignment.activityId!, { settings: { "grade[modgrade_point]": 10 } });
const after = await moodle.editActivity(3, page.activityId!, { visibility: "shown" });
console.log(after.changed);
```

## Categorías de datos {#data-categories}

Todas las funciones de esta página son `course-content`: `createActivity`, `updateActivity`, `activitySettings`, `editActivity`, `duplicateActivity`, `deleteActivity`, `addSection`, `editSection`, `deleteSection`, `courseActivityTypes`, y las de más bajo nivel `renameActivity` y `renameSection` (en `/internals`); `editCourse`, la acción en bruto del editor del curso, es `any`. Consulta [categorías de datos](../concepts/data-categories.md).

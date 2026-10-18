# Calificaciones y libro de calificaciones

Esta área cubre las calificaciones desde los dos lados. Un estudiante (o cualquiera a quien se califique en un curso) lee su propio informe de calificaciones con `myGrades`. Un profesor lee las calificaciones de todos con `graderReport` (o guarda el archivo de exportación de Moodle con `exportGrades`), califica en el libro de calificaciones con `setGrade` (la calificación de un elemento manual, o una anulación de la de una actividad), lee cómo está construido el libro de calificaciones con `gradebookSetup` y lo cambia con `addGradeItem`, `updateGradeItem`, `deleteGradeItem`, `addGradeCategory`, `updateGradeCategory` y `deleteGradeCategory`. Importa un archivo CSV de calificaciones con `importGrades` y gestiona las escalas y las letras con las que se muestran las calificaciones: `courseScales`, `addScale` y `editScale`, `gradeLetters` y `setGradeLetters`. Calificar una sola entrega está en [Calificar](grading.md); los intentos y las puntuaciones de un cuestionario, en [Cuestionarios](quizzes.md).

**Términos:** [libro de calificaciones](../reference/glossary.md#gradebook), [elemento de calificación](../reference/glossary.md#grade-item), [categoría de calificación](../reference/glossary.md#grade-category), [escala](../reference/glossary.md#scale).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Todo lo de aquí se lee de las propias páginas de Moodle por su estructura (clases de celda, atributos de datos, enlaces y nombres de campo), nunca por los textos de las cabeceras, así que funciona en un sitio en cualquier idioma. Las calificaciones llegan como el texto que muestra Moodle ("8.00", "80.00 %", "B+"), no como números: el formato lo deciden los ajustes de visualización de calificaciones del sitio.

## myGrades

El informe de calificaciones de usuario de la propia persona en un curso (`grade/report/user/index.php`), una fila por línea del informe.

```ts
function myGrades(context: BrowserContext, siteUrl: string, courseId: number): Promise<GradeRow[]>;

interface GradeRow {
  kind: "item" | "category" | "categoryTotal" | "courseTotal";
  name: string;
  activityId?: number;
  activityType?: string;
  grade?: string;
  range?: string;
  percentage?: string;
  weight?: string;
  letter?: string;
  feedback?: string;
  contribution?: string;
}
```

Las filas llegan en el orden del informe:

- `kind`: `"category"` es la fila de encabezado de una categoría, `"item"` un elemento de calificación (de una actividad o manual), `"categoryTotal"` la fila del total de una categoría y `"courseTotal"` el total del curso. El informe muestra el encabezado de una categoría, luego sus elementos y luego su total.
- `name`: el título de la fila tal como lo muestra el informe ("Quiz 1", "Programming total", "Course total").
- `activityId` y `activityType`: para el elemento de una actividad, su id del módulo del curso y su módulo ("quiz", "assign"…), leídos del enlace de la fila. Los elementos manuales, las categorías y los totales no los tienen.
- `grade`, `range`, `percentage`, `weight`, `letter`, `feedback`, `contribution`: las columnas del informe como texto ("8.00", "0–10", "80.00 %", "Well done"). Una columna que el sitio oculta, una celda vacía o el "-" de Moodle dejan fuera el campo, así que un `grade` ausente significa que aún no está calificado (o que está oculto para la persona).

El menú de acciones de la celda de calificación, cuyo texto está en el idioma del sitio, se quita antes de leer.

Lanza `NoGradeReportError` cuando la página no tiene informe de calificaciones: el curso no existe, la persona no se califica en él o las calificaciones están ocultas para ella. Una sesión que falta es `NotLoggedInError`, como en todas partes (consulta [Errores](../concepts/errors.md)).

[`pendingActivities`](courses.md#pendingactivities) usa este informe para encontrar actividades calificables aún sin calificación cuando un curso no registra la finalización.

## graderReport

Las calificaciones de todos en un curso tal como las muestra el informe del calificador del profesor (`grade/report/grader/index.php`), página a página hasta que no llegan filas nuevas, opcionalmente en un grupo.

```ts
function graderReport(context: BrowserContext, siteUrl: string, courseId: number, options?: { group?: number; userIds?: number[] }): Promise<GraderReport>;

interface GraderReport {
  columns: GradeColumn[];
  rows: { userId: number; fullName: string; grades: { itemId: number; grade?: string }[] }[];
}

interface GradeColumn {
  id: number;
  name: string;
  kind: "item" | "category" | "course";
  activityId?: number;
  activityType?: string;
}
```

- `group`: un id de grupo (consulta `groups` en [Participantes](participants.md)); sin él, el informe tal como se abre para la persona.
- `userIds`: solo las filas de estas personas. El informe no tiene filtro por usuario: se leen sus páginas hasta encontrarlas a todas.
- `columns`: una por elemento de calificación en el orden del informe, con `id` el id del elemento de calificación. `kind` es `"item"` para una actividad o un elemento manual, `"category"` para el total de una categoría y `"course"` para el total del curso. La columna de una actividad lleva su id del módulo del curso y su módulo.
- `rows`: una por participante, solo con el id de usuario y el nombre completo (sin correos ni otros campos de identidad). Cada calificación remite a una columna por `itemId`; una celda sin calificación ("-") no tiene campo `grade`.

Lanza `GradebookError` cuando Moodle rechaza la página (el mensaje lleva el motivo de Moodle, como "no permission (View grader report)") o el curso no existe, y también cuando la tabla del informe no está porque Moodle está recalculando las calificaciones del curso: consulta [Recálculo](#recalculation).

## gradebookSetup

Cómo está construido el libro de calificaciones de un curso, leído de la página "Configuración del libro de calificaciones" (`grade/edit/tree/index.php`): sus categorías y sus elementos de calificación.

```ts
function gradebookSetup(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ categories: GradebookCategory[]; items: GradebookItem[] }>;

interface GradebookCategory {
  id: number;
  itemId: number;
  name: string;
  parentId?: number;
  aggregation?: GradeAggregation;
  maxGrade?: number;
  weight?: number;
}

interface GradebookItem {
  id: number;
  name: string;
  categoryId?: number;
  type: string;
  maxGrade?: number;
  weight?: number;
  weightOverridden: boolean;
}
```

- El `id` de una categoría es el de la propia categoría; `itemId` es el elemento de calificación que guarda su total (el id de columna en `graderReport`). La categoría superior del curso no tiene `parentId`; las demás tienen el id de su padre.
- `aggregation`: cómo combina la categoría a sus hijos, uno de `GRADE_AGGREGATIONS` (abajo).
- `weight`: en porcentaje, cuando el padre agrega con pesos que se pueden editar (Natural); si no, se deja fuera.
- El `type` de un elemento es el módulo del elemento de una actividad ("assign", "quiz"…) o `"manual"` para un elemento creado en el libro de calificaciones. `categoryId` es la categoría que lo contiene. `weightOverridden` indica si el profesor fijó su peso en lugar de dejar que Natural lo calcule.

Los totales de categoría y de curso son el `itemId` de sus categorías, así que no vuelven a aparecer entre los `items`. Lanza `GradebookError` con el mensaje de Moodle cuando la página no es la configuración (sin permiso para gestionar calificaciones, o el curso no existe).

## updateGradeItem

Cambia un elemento de calificación: lo mueve a una categoría, fija su peso o fija su calificación máxima. Devuelve una frase que dice qué cambió y el elemento tal como lo muestra después la configuración.

```ts
function updateGradeItem(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  itemId: number,
  changes: { category?: number; weight?: number; maxGrade?: number },
): Promise<{ changed: string; item?: GradebookItem }>;
```

- `category`: un id de categoría de `gradebookSetup`; el elemento se mueve al principio de esa categoría, como hace la acción "Mover" de la página de configuración.
- `weight`: el peso del elemento en su categoría, en porcentaje. Anula el peso automático de Natural (`weightOverridden` pasa a ser `true`).
- `maxGrade`: la calificación máxima de un elemento manual. La máxima de una actividad se fija en los ajustes de la propia actividad (consulta [Actividades](activities.md)), así que para el elemento de una actividad lanza `GradebookError` antes de enviar nada.

Las opciones que se omiten se quedan como están; sin ninguna, `changed` es "Nothing to change.". El peso y la máxima pasan por el propio formulario dinámico de Moodle para elementos de calificación (`core_form_dynamic_form`), así que Moodle los valida como en la ventana modal: un valor que rechaza (un peso por encima de 100, por ejemplo) vuelve como `GradebookError` con cada campo y el mensaje de Moodle ("aggregationcoef2: Weight must be at most 100"). Un peso en un elemento cuya categoría no agrega con pesos editables lanza `GradebookError` pidiendo cambiar antes la agregación de la categoría. Un movimiento que Moodle no lleva a cabo (un id erróneo) también lanza `GradebookError`.

## addGradeCategory

Añade una categoría de calificación en el nivel superior del curso, o dentro de otra categoría, y la devuelve tal como la muestra la configuración.

```ts
function addGradeCategory(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { name: string; aggregation?: GradeAggregation; parentId?: number },
): Promise<{ changed: string; category?: GradebookCategory }>;
```

- `name`: el nombre completo de la categoría.
- `aggregation`: uno de `GRADE_AGGREGATIONS`; sin ella, la predeterminada del sitio.
- `parentId`: un id de categoría al que mover la nueva categoría; sin él, se queda en el nivel superior.

`GRADE_AGGREGATIONS` enumera las agregaciones por nombre, asociadas a las constantes de Moodle: `mean`, `median`, `lowest`, `highest`, `mode`, `weighted-mean`, `simple-weighted-mean`, `mean-with-extra-credits`, `natural`. Un administrador puede ocultar agregaciones a los profesores: pedir una que el sitio no ofrece lanza `GradebookError` nombrando las que ofrece ("The site doesn't offer the mean aggregation; it offers: natural."). Los errores del formulario de Moodle vuelven también como `GradebookError`.

## updateGradeCategory

Cambia una categoría de calificación: le cambia el nombre, cambia su agregación, fija su peso en su padre o la mueve a otra categoría. Devuelve una frase que dice qué cambió y la categoría después.

```ts
function updateGradeCategory(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  categoryId: number,
  changes: { name?: string; aggregation?: GradeAggregation; weight?: number; parentId?: number },
): Promise<{ changed: string; category?: GradebookCategory }>;
```

- `weight`: en porcentaje, anulando el peso automático de Natural, como hace `updateGradeItem` con un elemento. Un padre que no agrega con pesos editables lanza `GradebookError`.
- `parentId`: mueve la categoría al principio de esa categoría.
- `aggregation`: como en `addGradeCategory`, rechazada nombrando las ofrecidas cuando el sitio la oculta.

La propia categoría del curso (la que no tiene `parentId`) no tiene peso y no se puede mover: pedir cualquiera de las dos cosas lanza `GradebookError`. El nombre, la agregación y el peso pasan por el formulario dinámico de Moodle para categorías, así que sus errores vuelven como `GradebookError` con cada campo.

## deleteGradeCategory

Elimina una categoría de calificación, como hace "Eliminar" en la página de configuración. Moodle mueve lo que contenía (elementos y categorías) a su padre, y las calificaciones de su total se van con ella.

```ts
function deleteGradeCategory(context: BrowserContext, siteUrl: string, courseId: number, categoryId: number): Promise<{ changed: string }>;
```

La propia categoría del curso no se puede eliminar, y un id que la configuración no tiene lanza `GradebookError` antes de enviar nada.

## addGradeItem

Añade un elemento de calificación manual: uno que se califica en el libro de calificaciones y no mediante una actividad (la participación, un examen oral). Lo devuelve tal como lo muestra la configuración.

```ts
function addGradeItem(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { name: string; maxGrade?: number; scaleId?: number; categoryId?: number; hidden?: boolean },
): Promise<{ changed: string; item?: GradebookItem }>;
```

- `maxGrade`: sobre cuánto se califica; el valor predeterminado de Moodle (100) si se omite.
- `scaleId`: calificado con una escala en su lugar (una escala que el curso puede usar; otra lanza `GradebookError` nombrando las que ofrece). No junto con `maxGrade`.
- `categoryId`: la categoría en la que ponerlo; en el nivel superior del curso sin él.
- `hidden`: oculto a los estudiantes.

Pasa por el formulario dinámico de Moodle para elementos de calificación, así que los errores del formulario de Moodle vuelven como `GradebookError`. Califícalo con `setGrade`.

## deleteGradeItem

Elimina un elemento de calificación manual y sus calificaciones.

```ts
function deleteGradeItem(context: BrowserContext, siteUrl: string, courseId: number, itemId: number): Promise<{ changed: string }>;
```

El elemento de una actividad se va con su actividad (eliminarlo del libro de calificaciones solo haría que Moodle lo volviera a crear), así que para uno de ellos lanza `GradebookError` antes de enviar nada; igual que con un id que la configuración no tiene.

## setGrade

Fija la calificación de una persona en un elemento de calificación como lo hace un profesor en el informe de vista simple del libro de calificaciones (`grade/report/singleview/index.php`, la pantalla de la persona): un elemento manual recibe la calificación; el de una actividad o una categoría se anula. La retroalimentación y excluir la calificación de los totales van del mismo modo. Devuelve una frase que dice qué cambió y la calificación después.

```ts
function setGrade(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  itemId: number,
  userId: number,
  options: { grade?: number | string | null; feedback?: string; override?: boolean; excluded?: boolean },
): Promise<{ changed: string; grade: GradebookGrade }>;

interface GradebookGrade {
  itemId: number;
  userId: number;
  grade?: string;
  feedback?: string;
  overridden: boolean;
  excluded: boolean;
}
```

- `itemId`: el id de un elemento de calificación (una columna de `graderReport`, un elemento de `gradebookSetup`); `userId`: el de un participante, tal como lo dan las filas de `graderReport`.
- `grade`: un número para un elemento de valor, o el nombre o el valor de un elemento de la escala ("Good", `2`) para una escala; `null` la vacía. El rango de un elemento viene con su campo, así que una calificación fuera de él lanza `GradebookError` nombrando el rango antes de enviar nada ("takes grades from 0.00 to 10.00").
- `feedback`: texto; una cadena vacía la quita.
- `override`: solo para el elemento de una actividad o de una categoría. Una calificación o una retroalimentación ahí anula la de la actividad (Moodle lo exige, y mantiene la anulación hasta que se quita), así que `override` se puede omitir; `override: false` por sí solo devuelve la calificación a la actividad. La retroalimentación dada con la anulación se queda cuando se quita (comprobado empíricamente, Moodle 5.2): quítala antes con `feedback: ""`. En un elemento manual lanza `GradebookError`.
- `excluded`: deja la calificación fuera de los totales de la categoría y del curso.

Hay que dar al menos una opción. Cuando la calificación ya está como se pide, no se envía nada y `changed` es "Nothing to change.". `grade` llega tal como la muestra el informe ("8.50", el nombre del elemento de la escala).

Los campos del informe solo se muestran en modo edición: cuando la persona tiene el modo edición desactivado, se activa para el cambio con el propio interruptor de la página (o, en los temas que no lo tienen, como Classic en Moodle 4.5, con su botón «Activar edición») y se vuelve a desactivar después. Una calificación bloqueada, un elemento o una persona que el libro de calificaciones del curso no tiene y los avisos de Moodle al guardar (una calificación fuera de rango en un sitio con calificaciones ilimitadas) lanzan `GradebookError`. Calificar la entrega de una tarea, con su rúbrica y sus archivos de retroalimentación, es [`gradeSubmission`](grading.md); una anulación aquí es lo que Moodle muestra en el libro de calificaciones por encima de la calificación propia de la tarea.

## exportGrades

Guarda las calificaciones de un curso tal como Moodle las exporta para un profesor ("Exportar" en el libro de calificaciones): una hoja de cálculo, texto separado por comas o XML, el archivo que espera una secretaría o una hoja de cálculo. `graderReport` da las mismas calificaciones como datos.

```ts
function exportGrades(context: BrowserContext, siteUrl: string, courseId: number, options: ExportGradesOptions): Promise<DownloadedFile>;

interface ExportGradesOptions {
  format: "xlsx" | "ods" | "csv" | "xml";
  itemIds?: number[];
  groupId?: number;
  display?: ("real" | "percentage" | "letter")[];
  feedback?: boolean;
  destDir?: string;
}
```

- `format`: `xlsx` (la exportación "Hoja de cálculo Excel" de Moodle), `ods`, `csv` (su exportación a texto plano, separado por comas) o `xml`; `GRADE_EXPORT_FORMATS` los enumera.
- `itemIds`: los elementos de calificación que incluir (ids de `graderReport` o de `gradebookSetup`); todos si se omite. Uno que la exportación no ofrece lanza `GradebookError` nombrando los que sí ofrece.
- `groupId`: solo los miembros de ese grupo, como los elige el menú de grupos de la página de exportación (consulta `groups` en [Participantes](participants.md)).
- `display`: cómo se escribe cada calificación, una columna por forma; la predeterminada del sitio si se omite. XML admite exactamente una.
- `feedback`: añade la retroalimentación de cada calificación.
- `destDir`: la carpeta en la que guardar el archivo, una ruta absoluta. El [objeto Moodle](../concepts/calling-functions.md) usa su `downloadDir` cuando se omite; la función lanza un error sin ninguna.

Rellena el formulario de la página de exportación (`grade/export/<plugin>/index.php`) y guarda el archivo que envía Moodle con el nombre que le da Moodle ("mcp-content Grades-20261011_1805-comma_separated.csv"), sin sobrescribir nunca uno existente: se añade `(2)` como hace `downloadFile`. Devuelve el mismo `DownloadedFile` (`path`, `name`, `size`). Además de las calificaciones, la exportación de Moodle lleva el nombre y los apellidos de cada persona, su número de ID, su institución, su departamento y su dirección de correo.

Un administrador puede desactivar formatos de exportación: pedir uno que el sitio no ofrece lanza `GradebookError` nombrando los que sí ofrece ("The site doesn't export grades as xlsx; it exports as: csv, ods, xml."), leídos del menú de navegación del libro de calificaciones. La exportación XML de Moodle solo admite elementos con número de ID: cuando el curso no tiene ninguno, o `itemIds` nombra uno sin él, lanza `GradebookError` antes de enviar nada. Un curso que la persona no puede exportar (sin permiso) lanza `GradebookError` con el motivo de Moodle.

## importGrades

Importa calificaciones de un archivo CSV al libro de calificaciones de un curso, como hace la importación CSV de Moodle ("Importar" en el libro de calificaciones, `grade/import/csv/index.php`): el archivo se sube a su formulario y luego se rellena y envía el formulario de asignación que Moodle muestra bajo su vista previa.

```ts
function importGrades(context: BrowserContext, siteUrl: string, courseId: number, file: string, options: ImportGradesOptions): Promise<ImportGradesResult>;

interface ImportGradesOptions {
  mapFrom: string;
  mapTo: "id" | "username" | "idnumber" | "email";
  columns: Record<string, number | { feedback: number }>;
  preview?: boolean;
  separator?: "comma" | "semicolon" | "tab" | "colon";
  encoding?: string;
}

interface ImportGradesResult {
  changed: string;
  imported: boolean;
  preview: { columns: string[]; rows: string[][] };
  notices: string[];
}
```

- `file`: el archivo CSV, una ruta absoluta; su primera línea lleva las cabeceras de las columnas.
- `mapFrom`: la cabecera de la columna que identifica a cada persona; `mapTo`: qué contiene (el id de usuario de Moodle, el nombre de usuario, el número de ID o la dirección de correo).
- `columns`: las columnas que importar, por cabecera: a un elemento de calificación (su id de `gradebookSetup`), o como retroalimentación de un elemento (`{ feedback: <id del elemento> }`). Las demás columnas del archivo se ignoran.
- `preview`: solo sube el archivo y devuelve la vista previa de Moodle, sin importar nada.
- `separator` y `encoding`: cómo está escrito el archivo; una coma y UTF-8 si se omiten.

`preview` es la propia vista previa de Moodle: las cabeceras y las filas del archivo tal como Moodle las lee (con el separador y la codificación dados), todas. Moodle la muestra antes de la asignación, así que dice qué leerá Moodle, no qué calificaciones cambiarán. Las cabeceras de `mapFrom` y `columns` se comprueban con ella, y cada elemento con los que ofrece el formulario de asignación, en los dos casos, antes de importar nada: una cabecera que el archivo no tiene lanza `GradebookError` nombrando las columnas del archivo, y un elemento que el formulario no ofrece (el elemento de una actividad, uno bloqueado o uno que no está en el curso) lanza `GradebookError` nombrando los que sí ofrece.

Moodle importa todo o nada: cuando no encuentra a alguien ("User mapping error: Could not find user with username of …") o rechaza una calificación (fuera de rango), no se importa nada y `GradebookError` lleva los mensajes de Moodle. Las calificaciones de personas no matriculadas en el curso se importan con un aviso de Moodle, que se devuelve en `notices`. Quien no puede importar calificaciones recibe `GradebookError` nombrando las capacidades que hacen falta, `moodle/grade:import` y `gradeimport/csv:view`. Lee después las calificaciones con `graderReport`.

## courseScales

Las escalas de un curso, tal como las enumera su página "Escalas" (`grade/edit/scale/index.php`): las propias del curso y las escalas estándar del sitio.

```ts
function courseScales(context: BrowserContext, siteUrl: string, courseId: number): Promise<GradeScale[]>;

interface GradeScale {
  id: number;
  name: string;
  items: string[];
  used: boolean;
  site: boolean;
}
```

- `items`: los valores de la escala, del más bajo al más alto, tal como los guarda Moodle.
- `used`: algo califica con ella (un elemento de calificación, una actividad, un resultado). Moodle no cambia los valores de una escala en uso.
- `site`: una de las escalas estándar del sitio, no una propia del curso; las del curso van primero.

La página de un profesor no tiene enlaces para las escalas del sitio: sus ids salen del formulario de elementos del libro de calificaciones, que enumera las mismas escalas en el mismo orden. Da un id al `scaleId` de `addGradeItem` para calificar un elemento con ella. Quien no puede gestionar las escalas del curso recibe `GradebookError` nombrando `moodle/course:managescales`.

## addScale

Añade una escala a un curso (propia, no una del sitio) y la devuelve tal como la lee `courseScales`.

```ts
function addScale(context: BrowserContext, siteUrl: string, courseId: number, fields: { name: string; items: string[]; description?: string }): Promise<{ changed: string; scale?: GradeScale }>;
```

- `items`: los valores, del más bajo al más alto. Moodle los separa con comas, así que un valor con una coma se rechaza antes de enviar nada.
- `description`: HTML.

Rellena el formulario de la escala (`grade/edit/scale/edit.php`). Un curso no puede tener dos escalas con los mismos valores: Moodle rechaza la segunda y `GradebookError` lleva su mensaje. Quien no puede gestionar las escalas del curso recibe `GradebookError` nombrando `moodle/course:managescales`.

## editScale

Cambia una escala: su nombre, sus valores o su descripción. Devuelve la escala después.

```ts
function editScale(context: BrowserContext, siteUrl: string, courseId: number, scaleId: number, fields: { name?: string; items?: string[]; description?: string }): Promise<{ changed: string; scale?: GradeScale }>;
```

Una escala en uso conserva sus valores: Moodle los congela en el formulario, así que pedir valores nuevos lanza `GradebookError` antes de enviar nada (añade una escala nueva en su lugar); su nombre y su descripción sí cambian. Una escala del sitio solo la cambia quien puede gestionar las escalas del sitio; cualquier otra persona recibe `GradebookError` diciéndolo. Un id que no está entre las escalas del curso lanza `GradebookError`.

## gradeLetters

Las letras de calificación de un curso (`grade/edit/letter/index.php`, por el contexto del curso), del límite más alto al más bajo: las propias del curso cuando `overridden`, las predeterminadas del sitio si no.

```ts
function gradeLetters(context: BrowserContext, siteUrl: string, courseId: number): Promise<GradeLetters>;

interface GradeLetters {
  overridden: boolean;
  letters: { letter: string; minGrade: number }[];
}
```

`minGrade` es el límite inferior de la letra en porcentaje: una calificación recibe la letra del límite más alto que alcanza. Se leen del formulario de edición de las letras, así que quien no puede gestionarlas recibe `GradebookError` nombrando `moodle/grade:manageletters`.

## setGradeLetters

Fija las letras de calificación propias de un curso, anulando las del sitio, o, con `null`, vuelve a las predeterminadas del sitio. Devuelve las letras después, tal como las lee `gradeLetters`.

```ts
function setGradeLetters(context: BrowserContext, siteUrl: string, courseId: number, letters: { letter: string; minGrade: number }[] | null): Promise<{ changed: string; overridden: boolean; letters: { letter: string; minGrade: number }[] }>;
```

Las letras sustituyen la lista entera del curso: se escribe cada fila del formulario de Moodle y las filas que sobran se vacían, y Moodle las descarta. Un `minGrade` fuera de 0 a 100, una letra vacía o dos letras con el mismo `minGrade` se rechazan antes de enviar nada (Moodle se las saltaría sin decir nada).

## Recálculo {#recalculation}

Moodle recalcula las calificaciones de un curso tras algunos cambios (una actividad eliminada, pesos o agregaciones cambiados). Mientras lo hace, el informe del calificador muestra una barra de progreso en lugar de la tabla, y `graderReport` lanza `GradebookError` diciéndolo. Basta con esperar un momento y volver a llamar; no hay nada que arreglar.

## Ejemplo {#example}

Un profesor mueve las prácticas a una categoría nueva, da peso a la primera, califica un elemento manual, anula la calificación de un cuestionario y lee los totales del curso; un estudiante lee sus propias calificaciones.

```ts
import { GradebookError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

const setup = await moodle.gradebookSetup(3);
const { category } = await moodle.addGradeCategory(3, { name: "Prácticas", aggregation: "natural" });
if (category) {
  const labs = setup.items.filter((i) => i.type === "assign" && i.name.startsWith("Práctica"));
  for (const item of labs) {
    await moodle.updateGradeItem(3, item.id, { category: category.id });
  }
  // Dentro de la categoría Natural "Prácticas", la primera práctica cuenta un 40 %.
  if (labs[0]) await moodle.updateGradeItem(3, labs[0].id, { weight: 40 });
}

// Un elemento manual calificado en el libro de calificaciones, y una anulación de la calificación de un cuestionario para un estudiante.
const { item } = await moodle.addGradeItem(3, { name: "Participación", maxGrade: 10 });
if (item) await moodle.setGrade(3, item.id, 5, { grade: 8.5, feedback: "Activo en todas las clases" });
const quiz = setup.items.find((i) => i.type === "quiz");
if (quiz) await moodle.setGrade(3, quiz.id, 5, { grade: 7 });

try {
  const report = await moodle.graderReport(3);
  const total = report.columns.find((c) => c.kind === "course");
  for (const row of report.rows) {
    console.log(row.userId, row.grades.find((g) => g.itemId === total?.id)?.grade ?? "sin calificación");
  }
} catch (error) {
  if (error instanceof GradebookError) console.log(error.message);
  else throw error;
}

// Como estudiante: el total del curso del propio informe de la persona.
const mine = await moodle.myGrades(3);
console.log(mine.find((row) => row.kind === "courseTotal")?.grade);
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `myGrades`: `own`.
- `graderReport`, `exportGrades`: `others-personal` (las calificaciones de todos; la exportación añade sus correos).
- `gradebookSetup`, `updateGradeItem`, `addGradeItem`, `addGradeCategory`, `updateGradeCategory`, `deleteGradeCategory`: `course-content` (la estructura del libro de calificaciones, las calificaciones de nadie).
- `deleteGradeItem`: `course-content` y `others-write` (las calificaciones de un elemento manual se van con él).
- `setGrade`: `others-personal` y `others-write` (lee y decide la calificación de una persona).
- `importGrades`: `others-personal` y `others-write` (decide calificaciones; su vista previa muestra las personas y las calificaciones del archivo).
- `courseScales`, `addScale`, `editScale`, `gradeLetters`, `setGradeLetters`: `course-content` (cómo muestra el curso las calificaciones).

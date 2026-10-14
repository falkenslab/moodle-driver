# Copiar, hacer copias de seguridad y restaurar

Reutilizar un curso: copiarlo en uno nuevo, hacer una copia de seguridad de él (o de parte de él) en un archivo `.mbz`, leer lo que contiene un archivo de copia de seguridad, hacerlo anónimo para compartirlo, restaurar una copia de seguridad en un curso nuevo o en uno existente, e importar actividades de otro curso. Cada operación necesita los permisos de Moodle correspondientes, que un sitio solo concede en parte a los profesores: en un sitio por defecto, un profesor con permiso de edición puede hacer copias de seguridad e importar, y restaurar en sus propios cursos, pero no crear cursos, así que copiar y restaurar en un curso nuevo requieren un gestor, un creador de cursos o un administrador. Cuando Moodle lo rechaza, el `BackupError` dice qué permiso pide, con el propio mensaje de Moodle.

**Términos:** [copia de seguridad](../reference/glossary.md#backup), [id del módulo del curso](../reference/glossary.md#course-module-id), [sección](../reference/glossary.md#section).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

Copiar pasa por el servicio de copia de Moodle (`core_backup_submit_copy_form`), con los propios campos del formulario de copia; hacer copias de seguridad, restaurar e importar, por sus asistentes de páginas, paso a paso, como lo haría una persona. Moodle hace las copias, y las copias de seguridad y restauraciones cuando el sitio las hace asíncronas (su ajuste "copias de seguridad asíncronas"), en sus tareas programadas (cron): el driver las espera, consultando los servicios de progreso de Moodle, hasta `timeoutMs` (diez minutos si no se indica). Un sitio cuyo cron no se ejecuta nunca las termina: el `BackupError` tras la espera lo dice, y Moodle sigue cuando se ejecuta el cron. Todas las funciones salvo `backupContents` y `anonymizeBackup`, que leen y escriben archivos en este ordenador, lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

Una copia de seguridad es un archivo local, así que se puede restaurar en otro sitio: haz la copia de seguridad con un objeto `Moodle` y restáurala con otro, cada uno en su sitio, ambos en un mismo navegador si quieres (consulta [Varios sitios, varias cuentas](../concepts/browser.md#several-sites-several-accounts)).

```ts
interface CourseRef {
  id: number;
  fullName: string;
  shortName: string;
  categoryId?: number;
  url: string;
}
```

## copyCourse

Copia un curso en uno nuevo, como "Copiar curso" de Moodle.

```ts
function copyCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { fullName: string; shortName: string; categoryId?: number; start?: Date; end?: Date; withUsers?: boolean; visible?: boolean; timeoutMs?: number },
): Promise<{ changed: string; course: CourseRef }>;
```

- `fullName` y `shortName` dan nombre al nuevo curso (el nombre corto debe estar libre); `categoryId` es la categoría (la del propio curso si no se indica); `start` y `end`, sus fechas; `visible`, si lo ven los estudiantes.
- `withUsers` copia los datos de las personas y conserva las matriculaciones de todos; sin él, solo el contenido.
- Devuelve el nuevo curso, que se encuentra por su nombre corto cuando Moodle ha terminado.

Necesita `moodle/backup:backupcourse`, `moodle/restore:restorecourse` y `moodle/course:create`. Una copia cuyos ajustes rechaza Moodle (un nombre corto ya usado) es un `BackupError`.

## backupCourse

Hace una copia de seguridad de un curso en un archivo y lo descarga.

```ts
function backupCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  destDir: string,
  options?: { withUsers?: boolean; anonymize?: boolean; sections?: number[]; activities?: number[]; anonymous?: boolean; timeoutMs?: number },
): Promise<{ changed: string; file: DownloadedFile }>;
```

- El curso entero, sin los datos de sus personas salvo con `withUsers` (que necesita `moodle/backup:userinfo`; `anonymize` hace anónimos sus nombres, el propio ajuste de Moodle).
- `sections` (ids de sección) y `activities` (ids de los módulos del curso, tanto de actividades como de recursos, de la [estructura](courses.md#coursestructure) del curso) hacen copia de seguridad solo de una parte del curso: cada sección con todo lo que contiene (también sus subsecciones), cada actividad sola. Moodle necesita la sección de una actividad en la copia de seguridad para contenerla, así que la sección viene con su nombre y su descripción, y solo con las actividades elegidas. Una sección o actividad que el curso no tiene es un `MoodleError` con código `not-found`.
- `anonymous` hace que el archivo no nombre a nadie ni a ningún sitio, mediante [`anonymizeBackup`](#anonymizebackup): true si no se indica en una selección (`sections` o `activities`), false en un curso entero. No se puede combinar con `withUsers`.
- `destDir` es una carpeta absoluta: el archivo se guarda ahí con el nombre que le da Moodle (`backup-moodle2-course-3-…mbz`), o `backup-moodle2-anonymous-<date>.mbz` cuando es anónimo, sin sobrescribir nunca (consulta [Archivos](files.md)). Moodle también lo conserva, tal como lo hizo Moodle, en el área de copias de seguridad del curso o de la persona, como las lista su página de restauración.

Necesita `moodle/backup:backupcourse`; Moodle rechaza una segunda copia de seguridad de un curso mientras otra está esperando al cron.

### Parte de un curso, para compartir {#part-of-a-course-to-share}

Una copia de seguridad de parte de un curso está pensada para viajar: guardarla, compartirla con otros profesores y restaurarla en sus cursos, quizá en otro sitio. Así que lleva el contenido y nada de las personas del curso ni del propio curso: los ajustes del asistente para usuarios, sus roles, comentarios, finalización, registros, historial de calificaciones y estados xAPI están desactivados (con los usuarios desactivados, también lo están las entregas, los intentos, los mensajes y las calificaciones), y también los bloques, filtros, insignias, eventos del calendario, grupos, competencias, campos personalizados, banco de contenido y archivos heredados del curso, que de otro modo una restauración añadiría al curso en el que se restaura. Las fechas y los eventos propios de las actividades vuelven con ellas (Moodle los reconstruye). `withUsers` no se puede combinar con una selección.

El driver no se fía de eso: lee el archivo después, y un archivo que contiene otras actividades distintas de las pedidas, o cualquier dato de las personas, se borra y la llamada falla con `BackupError`.

Incluso sin datos de las personas, el archivo de Moodle nombra a personas y su origen: quién subió cada archivo y el nombre de su autor, quién creó, cambió y es dueño de cada pregunta, la dirección y el identificador del sitio original, el id y los nombres del curso, el host del sitio en los sellos de las preguntas. Así que una selección es [anónima](#anonymizebackup) salvo con `anonymous: false`: el archivo queda listo para un catálogo compartido entre profesores.

Hacer la copia de seguridad solo lee el curso: Moodle guarda el archivo en el área privada de copias de seguridad de la persona (ahí va una copia de seguridad sin datos de usuarios) y registra que se hizo una copia de seguridad; nada más cambia.

## restoreCourse

Restaura un archivo de copia de seguridad mediante el asistente de restauración de Moodle.

```ts
function restoreCourse(
  context: BrowserContext,
  siteUrl: string,
  file: string,
  options: {
    into: "new" | number;
    categoryId?: number;
    mode?: "merge" | "replace";
    fullName?: string;
    shortName?: string;
    withUsers?: boolean;
    sectionId?: number;
    afterSectionId?: number;
    timeoutMs?: number;
  },
): Promise<{ changed: string; course: CourseRef; sectionIds?: number[]; activityIds?: number[]; warnings?: RestoreWarning[] }>;
```

- `into: "new"` crea un curso en `categoryId` (obligatorio), con el nombre de la copia de seguridad salvo que se indiquen `fullName` y `shortName`; necesita `moodle/course:create` ahí.
- `into: <course id>` restaura en ese curso: `mode: "merge"` (el valor por defecto) añade el contenido de la copia de seguridad al del curso, `"replace"` borra primero el contenido del curso, lo que no se puede deshacer. Devuelve las secciones (`sectionIds`) y las actividades (`activityIds`) nuevas que tiene el curso después, en el orden del curso, y lo que la restauración dejó roto en ellas (`warnings`, más abajo).
- `sectionId` y `afterSectionId` dicen dónde va una restauración fusionada (más abajo); sin ellos, donde la ponga Moodle.
- `withUsers` restaura los datos de las personas cuando la copia de seguridad los tiene (`moodle/restore:userinfo`).
- `file` es una ruta absoluta a un `.mbz`; se sube como lo hace el selector de archivos de la página de restauración.

Necesita `moodle/restore:restorecourse` donde restaura. Un archivo que no es una copia de seguridad de Moodle, o que Moodle no puede leer, es un `BackupError`.

### Comprobado antes del asistente {#checked-before-the-wizard}

El driver lee primero la copia de seguridad (su `moodle_backup.xml`) y rechaza, con un `BackupError` que nombra lo que falta, una copia de seguridad que Moodle restauraría mal:

- hecha en un Moodle más reciente que el del sitio (por rama: 5.3 en un sitio 5.2; 5.2.4 en 5.2.0 sigue adelante). Moodle solo avisa, y una restauración así puede fallar a medias. La rama del sitio se lee del enlace a la documentación que pone Moodle en su página de restauración; un sitio que no muestra ninguno no se comprueba.
- que contiene actividades de un tipo que el sitio no ofrece a la persona en ese curso (un plugin como `questionnaire` no instalado, desactivado, o que ella no puede añadir): Moodle restauraría el resto y se saltaría esas sin decir nada. Un curso en el que la persona no puede añadir nada no se comprueba.

Una copia de seguridad en formato zip (la hace un sitio con el `usezipbackups` de Moodle) no se lee: Moodle la restaura sin comprobar.

### Dónde va una restauración fusionada {#where-a-merged-restore-goes}

Moodle pone cada una de las secciones de la copia de seguridad en la sección del curso con el mismo número, creándola cuando el curso no la tiene, y cada actividad al final de su sección; una sección del curso que no tenía nombre, descripción, restricciones ni visibilidad propios toma los de la copia de seguridad (`restore_section_structure_step`, confirmado en Moodle 5.2). El asistente no permite elegir un lugar, así que el driver restaura y luego mueve lo que hizo Moodle:

- `sectionId`: todas las actividades restauradas al final de esa sección, en el orden de la copia de seguridad; las secciones que Moodle creó para ellas se borran.
- `afterSectionId`: cada una de las secciones de la copia de seguridad como una sección nueva, en orden, justo después de esa. Una sección que Moodle fusionó con una de las del curso se separa en una nueva, con el nombre y la visibilidad de la sección de la copia de seguridad (también su descripción, salvo que tenga archivos o enlaces a otras actividades, que solo la restauración de Moodle puede trasladar).

Con cualquiera de los dos, lo que Moodle llevó de la copia de seguridad a las secciones propias del curso (un nombre, una descripción, restricciones, ocultarlas) se restablece. Colocar cuesta un movimiento por cada sección restaurada, y un vistazo a la página del curso antes y después.

### Lo que una restauración dejó roto {#what-a-restore-left-broken}

Moodle restaura una pieza sacada de su curso sin decir nada de aquello a lo que apuntaba: una restricción sobre una actividad, una calificación, un grupo o un agrupamiento que la copia de seguridad no contenía se queda, marcada como rota; un enlace en su texto a una actividad que no contenía apunta a la original (en el sitio original). Al restaurar en un curso existente, `warnings` los lista, uno por problema, leídos de los formularios de ajustes de las actividades restauradas (las que tienen restricciones, y aquellas cuyo texto enlazaba a otras partes de la copia de seguridad), para que un programa pueda decirle al profesor qué arreglar:

```ts
interface RestoreWarning {
  activityId: number; // la actividad restaurada, en el curso en el que se restauró
  name: string;
  kind: "restriction" | "link";
  condition?: "completion" | "grade" | "group" | "grouping"; // en una restricción
  url?: string; // en un enlace: adónde apunta
  message: string;
}
```

`backupContents` dice lo mismo antes de restaurar, a partir del archivo.

## backupContents

Lo que contiene un archivo de copia de seguridad, leído en este ordenador: sin navegador, sin sesión, sin sitio.

```ts
function backupContents(file: string): Promise<BackupContents>;

interface BackupContents {
  name: string; // el del archivo
  type: "course" | "section" | "activity"; // una parte de un curso es "course", como lo escribe Moodle
  moodle: { version: string; release: string }; // el Moodle que lo hizo: "2026042004", "5.2.4 (Build: 20261005)"
  original: { site?: string; courseId: number; courseFullName?: string; courseShortName?: string; format?: string };
  sections: { id: number; number?: number; name?: string; summary?: string; visible?: boolean; parentActivityId?: number }[];
  activities: { id: number; type: string; title: string; sectionId: number; dependencies: BackupDependency[] }[];
  plugins: string[]; // "mod_quiz", "qtype_multichoice", "block_html", "format_topics"
  withUsers: boolean; // contiene datos de las personas
  gradebook: boolean; // contiene la configuración del libro de calificaciones del curso (una parte de un curso no la contiene)
  identifies: BackupIdentifier[]; // lo que todavía nombra a una persona, al sitio o al curso: vacío una vez anónimo
}

interface BackupIdentifier {
  file: string; // el archivo de la copia de seguridad en el que está: "files.xml", "questions.xml", "moodle_backup.xml"…
  field: string; // "userid", "author", "createdby", "original_wwwroot", "stamp"…, o "text" para la dirección del sitio en un texto
  value: string;
}

interface BackupDependency {
  kind: "restriction" | "link" | "grade-category";
  condition?: "completion" | "grade" | "group" | "grouping";
  activityId?: number;
  module?: string;
  gradeItemId?: number;
  groupId?: number;
  groupingId?: number;
  categoryId?: number;
}
```

- Los ids son los del sitio original: el `number` de una sección es donde la pone una restauración fusionada (ver arriba), y una sección sin `name` toma el nombre por defecto del formato del curso.
- `plugins` son lo que un sitio necesita para restaurarlo todo: los módulos de las actividades, los tipos de las preguntas, los bloques y el formato del curso (para un curso nuevo). `restoreCourse` comprueba los módulos antes de restaurar.
- `dependencies`, por actividad, aquello a lo que se refiere y que la copia de seguridad no contiene: una `restriction` sobre la finalización de otra actividad (`activityId`), sobre un elemento de calificación (`gradeItemId`), un grupo o un agrupamiento; un `link` en su texto a otra actividad (`activityId`, `module`); y, en una copia de seguridad sin el libro de calificaciones, la `grade-category` en la que estaba su calificación (al restaurarla, va a la categoría superior del curso; puede que la original también fuera la superior, la copia de seguridad no lo dice). Se leen del XML de la actividad: las restricciones en `module.xml`, los enlaces tal como los codifica Moodle en una copia de seguridad (`$@PAGEVIEWBYID*12@$`), los elementos de calificación en `grades.xml`.
- Un archivo que no es una copia de seguridad de Moodle es un `BackupError` que lo dice; uno en formato zip (`usezipbackups`) también, ya que el driver no los lee. Un archivo que no existe es un `MoodleError` con código `not-found`.

- `identifies` lista lo que en el archivo nombra a una persona o de dónde viene, con las mismas reglas que limpia [`anonymizeBackup`](#anonymizebackup): un catálogo puede rechazar un archivo cuya lista no esté vacía.

También es `moodle.backupContents(file)` y `moodle backup-contents <file>`, ninguno de los cuales abre el navegador.

## anonymizeBackup

Escribe una copia de un archivo de copia de seguridad que no nombra a nadie ni a ningún sitio, para un catálogo compartido entre profesores: en este ordenador, sin navegador, sin sesión.

```ts
function anonymizeBackup(file: string, destFile: string): Promise<{ changed: string; file: { path: string; name: string; size: number }; cleared: BackupIdentifier[] }>;
```

Lo que limpia, en todos los archivos XML de la copia de seguridad (tal como los escribe Moodle 5.2, confirmado en copias de seguridad de páginas con imágenes, archivos, cuestionarios con preguntas propias y de un banco compartido, foros, áreas de texto y medios y URL):

- Personas: todos los ids de usuario pasan a 0 (`userid`, `usermodified`, `usercreated`, `createdby`, `modifiedby`, `ownerid` y los demás campos que Moodle anota como usuarios), el `author` de cada archivo queda vacío (Moodle guarda ahí el nombre completo de quien lo subió), y el nombre, la dirección y el contacto del emisor de una insignia, vacíos.
- El sitio: la dirección del sitio original pasa a ser `https://anonymous.invalid` (un nombre que no puede existir) y su hash identificador, 32 ceros; el host del sitio en los sellos de las categorías de preguntas y de las preguntas (`localhost:8080+261013225433+oNq8QS`) pasa a ser `anonymous`; la dirección del sitio que quede en un texto (un enlace que Moodle no codifica, como el de un perfil) pasa a ser la anónima; el nombre de la categoría del curso se vacía; el registro de la copia de seguridad se vacía.
- El curso: su id pasa a 0 y sus nombres a "Restored course" y "restored" (en la descripción de la copia de seguridad y en `course/course.xml`, con su número de ID vaciado), y el nombre del archivo en la descripción, a `backup.mbz`; los enlaces de Moodle al curso (`$@COURSEVIEWBYID*…@$`, las páginas índice de los módulos) siguen al nuevo id.

Lo que se queda: el contenido (textos, ajustes, los propios archivos, sus nombres y licencias), las fechas, y los ids numéricos de las piezas de la copia de seguridad (actividades, secciones, contextos, preguntas), que solo enlazan sus archivos entre sí. Los metadatos propios de un archivo (los datos EXIF de una foto, el autor de un documento) son del contenido, y también se quedan.

`cleared` lista lo que se ha limpiado (tal como lo daba el `identifies` de `backupContents`), y la copia se vuelve a leer: no puede quedar nada. `destFile` es una ruta absoluta, y puede ser el propio `file`. Una copia de seguridad con datos de usuarios es un `BackupError`: sus personas son más que metadatos, y la propia anonimización de Moodle se encarga de ellas (`withUsers` de `backupCourse` con `anonymize`). Algo que no es una copia de seguridad, o una en formato zip, es un `BackupError`, como en `backupContents`.

Al restaurarla, la copia es una copia de seguridad de otro sitio, vaya donde vaya, incluido el sitio del que salió (confirmado en 5.2, restaurando en el sitio que la hizo):

- Llega todo: las actividades, sus archivos (incluidas las imágenes de una página), las preguntas de los cuestionarios; los enlaces entre las actividades restauradas con ella se resuelven hacia ellas, y los enlaces al curso y a sus páginas índice, hacia el curso en el que se restaura.
- Las preguntas y los archivos son de la persona que la restaura (Moodle se los asigna a quien restaura cuando los usuarios de la copia de seguridad no están en el sitio), no de quien los hizo.
- Las preguntas de un cuestionario procedentes de un banco compartido que la copia de seguridad dejó fuera llegan a un banco nuevo del curso: el cuestionario es autosuficiente. Restaurado tal como lo hizo Moodle en su propio sitio, el cuestionario apuntaría en cambio a las preguntas del banco original.
- Los enlaces a actividades que quedaron fuera de la copia de seguridad apuntan a `https://anonymous.invalid/…` (tal como lo hizo Moodle, al sitio original): `restoreCourse` los comunica como avisos.
- Un curso nuevo toma los nombres "Restored course" y "restored" salvo que la restauración le dé otros.

También es `moodle.anonymizeBackup(file, destFile)` y `moodle anonymize-backup <file> <destFile>`, ninguno de los cuales abre el navegador.

## importActivities

Importa actividades de otro curso, como "Importar" de Moodle.

```ts
function importActivities(context: BrowserContext, siteUrl: string, fromCourseId: number, toCourseId: number, options?: { activityIds?: number[] }): Promise<{ changed: string; activityIds: number[] }>;
```

- Todas las actividades de `fromCourseId`, o solo `activityIds` (ids de los módulos del curso, de su [estructura](courses.md#coursestructure)), se añaden a `toCourseId` con su sección; nunca los datos de sus personas.
- Devuelve los ids de los módulos del curso nuevos que tiene `toCourseId` después.

Necesita `moodle/restore:restoretargetimport` en el curso al que se importa y `moodle/backup:backuptargetimport` en el otro, que los profesores con permiso de edición tienen en sus cursos.

## Ejemplo {#example}

```ts
import { BackupError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  // El curso del año que viene a partir del de este año, y un foro de otro curso (4) dentro de él.
  const { course } = await moodle.copyCourse(3, { fullName: "Programación 2027", shortName: "prog-2027", start: new Date("2027-09-15") });
  const { activityIds } = await moodle.importActivities(4, course.id, { activityIds: [46] });
  console.log(`Curso ${course.id}, con las actividades ${activityIds.join(", ")} importadas`);

  // Una copia de seguridad en disco, restaurada como curso nuevo en otro lugar.
  const { file } = await moodle.backupCourse(3, "/home/ada/backups");
  const restored = await moodle.restoreCourse(file.path, { into: "new", categoryId: 1, fullName: "Programación (archivo)", shortName: "prog-archive" });
  console.log(restored.changed);

  // Una unidad (sección 12) y un cuestionario (actividad 57) para compartir (anónimos, como toda parte), restaurados como secciones nuevas tras la sección 30 del curso 8.
  const part = await moodle.backupCourse(3, "/home/ada/backups", { sections: [12], activities: [57] });
  const contents = await moodle.backupContents(part.file.path);
  if (contents.identifies.length > 0) throw new Error("No está listo para el catálogo");
  for (const activity of contents.activities) if (activity.dependencies.length > 0) console.log(`"${activity.title}" depende de cosas que quedaron fuera`, activity.dependencies);
  const placed = await moodle.restoreCourse(part.file.path, { into: 8, afterSectionId: 30 });
  console.log(`Secciones nuevas ${placed.sectionIds?.join(", ")}, actividades nuevas ${placed.activityIds?.join(", ")}`);
  for (const warning of placed.warnings ?? []) console.log(warning.message);
} catch (error) {
  if (error instanceof BackupError) console.error(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

- `copyCourse`, `backupCourse`, `restoreCourse`: `course-content`, y `others-personal` (los datos de las personas, con `withUsers`).
- `importActivities`, `backupContents`, `anonymizeBackup`: `course-content`.

Consulta [Categorías de datos](../concepts/data-categories.md).

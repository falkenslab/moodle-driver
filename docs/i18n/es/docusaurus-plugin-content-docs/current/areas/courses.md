# Cursos

Los cursos en los que está matriculada la persona, las secciones y actividades de un curso, sus tareas, lo que la persona aún tiene que hacer en él, cambiar los ajustes de un curso y reiniciarlo para un nuevo curso académico. Leer funciona para cualquier matriculado (estudiante o profesor); `updateCourse` requiere el derecho a editar los ajustes del curso, que tienen los profesores con permiso de edición y los gestores. Todo lo de aquí se lee mediante los servicios que usa la propia página del curso (`core_course_get_enrolled_courses_by_timeline_classification`, `core_courseformat_get_state`), así que no depende del idioma de la interfaz, salvo los detalles (las fechas y restricciones de las actividades, las descripciones de las secciones), que se leen de la página del curso tal como los muestra.

**Términos:** [sección](../reference/glossary.md#section), [actividad](../reference/glossary.md#activity), [módulo](../reference/glossary.md#module), [id de módulo del curso](../reference/glossary.md#course-module-id), [finalización](../reference/glossary.md#completion).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## listCourses

Los cursos en los que está matriculada la persona, como profesor o como estudiante, ordenados por nombre completo.

```ts
function listCourses(context: BrowserContext, siteUrl: string, classification?: CourseClassification): Promise<Course[]>;

type CourseClassification = "all" | "inprogress" | "future" | "past"; // COURSE_CLASSIFICATIONS
```

`classification` vale `"all"` por defecto, que incluye también los cursos que la persona ocultó en su área personal. `"inprogress"`, `"future"` y `"past"` filtran por las fechas del curso, como hace la vista general de cursos del área personal.

Cada `Course` tiene:

- `id`: el id de curso que reciben todas las funciones de cursos.
- `shortname`, `fullname`: con las entidades HTML decodificadas.
- `category`: el nombre de la categoría, cuando Moodle lo da.
- `url`: la página del curso.
- `visible`: si los estudiantes pueden ver el curso.
- `startDate`, `endDate`: ISO 8601, ausentes cuando el curso no las tiene.
- `progress`: el porcentaje de finalización de la persona, solo cuando el curso registra la finalización.
- `lastAccess`: cuándo abrió la persona el curso por última vez (ISO 8601).

Lanza `NotLoggedInError` sin sesión, y `MoodleServiceError` si el servicio falla.

## courseStructure

Las secciones y actividades de un curso, en el orden del curso.

```ts
function courseStructure(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { details?: boolean },
): Promise<CourseSection[]>;
```

Con `details: false` (lo predeterminado) hace una sola llamada al servicio. Con `details: true` además abre la página del curso y lee las fechas y la restricción de cada actividad tal como las muestra la página, y la descripción de cada sección; en un curso con una sección por página abre entonces las páginas de sección de las actividades que la página del curso no muestra. Eso es más lento, y los textos llegan en el idioma del sitio (por ejemplo `{ label: "Due", value: "Friday, 23 October 2026, 12:00 AM" }`).

Cada `CourseSection` tiene `id`, `number` (0 es la sección general), `title`, `visible`, `restricted` (tiene restricciones de acceso), `url`, `parentSectionId` (para una subsección, la sección que la contiene), `summary` (solo con `details`: la descripción de la sección como HTML, tal como la presenta la página del curso, cuando tiene una; fíjala con [editSection](activities.md#addsection-editsection-and-deletesection)) y `activities`. Cada `CourseActivity` tiene:

- `id`: el id de módulo del curso, que reciben todas las funciones de actividades.
- `name`, `type`: el módulo, como `"page"`, `"assign"`, `"quiz"`, `"forum"` o `"resource"`.
- `url`: la página de la actividad, cuando tiene una (un área de texto y medios no la tiene).
- `visible`: visible para los estudiantes.
- `availableToMe`: la persona puede abrirla ahora. Para un estudiante, false en una actividad bloqueada por una restricción (una oculta a los estudiantes ni siquiera se le lista); para un profesor, true tanto en actividades ocultas como restringidas, porque puede abrirlas (`visible: false, availableToMe: true` es una actividad oculta vista por su profesor).
- `restricted`: tiene restricciones de acceso.
- `completion`: la finalización de la persona, solo cuando la actividad la registra para ella: `state` es uno de `"incomplete"`, `"complete"`, `"complete-pass"`, `"complete-fail"` (`COMPLETION_STATES`), y `complete` es el veredicto global de Moodle.
- `dates`, `restriction`: solo con `details`.

Un curso que la persona no puede ver vuelve como el `MoodleServiceError` de Moodle (su `errorcode` dice por qué); la falta de sesión es `NotLoggedInError`.

## courseState y activityDetails {#coursestate-and-activitydetails}

Las piezas de las que está hecho `courseStructure`, en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

```ts
function courseState(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseState>;
function activityDetails(context: BrowserContext, siteUrl: string, courseId: number, state: CourseState): Promise<Map<number, ActivityDetails>>;
```

- `courseState` devuelve `core_courseformat_get_state` interpretado, con los propios nombres de campo de Moodle (`section`, `cm`, `cmlist`, `uservisible`, `completionstate`…); el tipo enumera los campos que lee el driver, tal como los devuelven Moodle 4.0 a 5.2.
- `activityDetails` lee la página del curso (y las páginas de sección que necesita) y devuelve, por id de módulo del curso, `{ id, dates: { label, value }[], restriction? }`.

## pendingActivities

Lo que la persona aún tiene que hacer en un curso.

```ts
function pendingActivities(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
): Promise<{ completionTracked: boolean; pending: PendingActivity[] }>;
```

Una actividad está pendiente cuando su finalización se registra para la persona y no está completa (`reason: "incomplete"`), o, cuando no se registra la finalización, cuando es una actividad calificable sin calificación todavía en el informe de calificaciones de la persona (`reason: "not-graded"`). Se dejan fuera las actividades ocultas a los estudiantes y las no disponibles para la persona. `completionTracked` indica si el curso registra la finalización para la persona en absoluto.

Cada `PendingActivity` tiene `activityId`, `name`, `type`, `url`, `section` (`{ number, title }`), `reason`, `completion` (el estado, cuando se registra), `availableToMe`, y las `dates` y la `restriction` de la página del curso. Siempre lee los detalles, así que abre la página del curso (y las páginas de sección cuando hace falta) y el informe de calificaciones: está pensada para un estudiante. Si el informe de calificaciones no se puede leer, la comprobación de calificaciones simplemente se omite.

## listAssignments

Las tareas del curso, en el orden del curso, a partir del mismo estado del curso.

```ts
function listAssignments(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseAssignment[]>;
```

Cada `CourseAssignment` tiene `id` (el id de módulo del curso, para [tareas](assignments.md) y [calificar](grading.md)), `name`, `url`, `visible` y `section` (`{ number, title }`).

## updateCourse

Cambia los ajustes de un curso mediante su formulario de ajustes (`course/edit.php`), como lo haría un profesor, y devuelve el curso tal como lo da `listCourses`.

```ts
function updateCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  changes: { fullName?: string; shortName?: string; summary?: string; settings?: Record<string, FieldValue>; embed?: string[] },
): Promise<{ changed: string; course?: Course }>;
```

- `fullName`, `shortName`: los nombres del curso.
- `summary`: HTML, fijado mediante el editor de la descripción.
- `embed`: rutas locales absolutas de imágenes y archivos que nombra el `summary` (`<img src="banner.png">`), puestos en él como lo hace el editor de Moodle (consulta [Incrustar archivos en texto enriquecido](files.md#embedding-files-in-rich-text)).
- `settings`: cualquier otro campo del formulario por su nombre en el formulario (`startdate[day]`, `visible`, `format`…); `FieldValue` es una cadena, un número, un booleano o un array de cadenas. Las opciones con nombre ganan a `settings` cuando ambas fijan el mismo campo.

Sin nada que cambiar devuelve `changed: "Nothing to change."` sin abrir el formulario. `course` es `undefined` cuando la persona no está matriculada en el curso (por lo que `listCourses` no lo lista).

Errores:

- `CourseError` cuando el formulario no se puede abrir: el curso no existe o la persona no tiene permiso.
- `FormError` cuando Moodle rechaza el formulario (un nombre corto ya usado), con `fields` con el mensaje de Moodle por campo, o cuando un campo de `settings` no está en el formulario o está desactivado.

## resetCourse

Vacía un curso de los datos de su gente para un nuevo curso académico, conservando su contenido, mediante el formulario de reinicio de Moodle. **No se puede deshacer.**

```ts
function resetCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { delete?: ResetDeletions; unenrolRoles?: number[]; start?: Date; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; report: ResetStatus[] }>;

interface ResetDeletions {
  submissions?: boolean; // entregas de las tareas
  attempts?: boolean; // intentos de cuestionarios, lecciones, SCORM y H5P
  posts?: boolean; // todos los mensajes de los foros
  grades?: boolean; // todas las calificaciones del libro de calificaciones
  overrides?: boolean; // excepciones de tareas, cuestionarios y lecciones
  choices?: boolean; // respuestas de las consultas
  events?: boolean; // los eventos del calendario del curso
  groups?: boolean; // grupos y agrupamientos
  completion?: boolean; // datos de finalización
  notes?: boolean;
  comments?: boolean;
}

interface ResetStatus {
  component: string;
  item: string;
  done: boolean;
  error?: string;
}
```

- Solo se reinicia lo que se nombra: el formulario de Moodle se abre con sus propios valores predeterminados marcados (eventos, calificaciones, los datos de todos los módulos…), y antes se desmarcan todos. Una llamada que no nombra nada lanza `MoodleError` con el código `invalid-input`.
- `delete` nombra cada tipo de dato, que se marca en todos los módulos del curso que lo tienen (los `reset_assign_submissions`, `reset_quiz_attempts`, `reset_lesson`, `reset_scorm`… del formulario de reinicio); un tipo que ninguna actividad del curso tiene se deja fuera, y `changed` lo dice.
- `unenrolRoles` da de baja a todos los que tienen estos roles (ids de rol, como en [Participantes](participants.md); 5 es Estudiante en un sitio predeterminado); un rol que el formulario no ofrece es un `CourseError`.
- `start` mueve la fecha de inicio del curso, y con ella las fechas de sus actividades, como hace la fecha de inicio del formulario.
- `fields` fija cualquier otro campo del formulario por nombre (`reset_forum_subscriptions`, `reset_glossary_all`…).
- `report` es la tabla que Moodle muestra después: por componente, cada tarea, `done`, o su `error` en el idioma del sitio (un módulo sin soporte de reinicio llega como "Reset not supported").

El diálogo de confirmación del botón de reinicio se omite: el formulario se envía como lo hace el diálogo una vez confirmado. Un sitio que hace los reinicios asíncronos lo pone en cola para el cron, y `report` llega vacío. Requiere `moodle/course:reset` (los profesores con permiso de edición lo tienen); sin él, `CourseError`.

## Ejemplo {#example}

```ts

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

for (const course of await moodle.listCourses("inprogress")) {
  console.log(`${course.id} ${course.fullname}${course.progress !== undefined ? ` (${course.progress}%)` : ""}`);
}

const sections = await moodle.courseStructure(3, { details: true });
for (const section of sections) {
  console.log(`${section.number}. ${section.title}`);
  for (const activity of section.activities) {
    const due = activity.dates?.map((d) => `${d.label}: ${d.value}`).join("; ") ?? "";
    console.log(`  [${activity.type}] ${activity.id} ${activity.name} ${due}`);
  }
}

const { completionTracked, pending } = await moodle.pendingActivities(3);
console.log(completionTracked ? "La finalización se registra" : "La finalización no se registra", pending.map((p) => p.name));

const { course } = await moodle.updateCourse(3, { fullName: "Programación 101 (2026)", summary: "<p>Bucles, funciones y recursividad.</p>" });
console.log(course?.fullname);
```

## Categorías de datos {#data-categories}

`listCourses` es `own`. `courseState` y `courseStructure` son `course-content` y `own` (el estado lleva la finalización de la persona), igual que `pendingActivities` (`own`). `activityDetails` y `listAssignments` son `course-content`. `updateCourse` es `course-content`; `resetCourse` es `course-content` y `others-write` (elimina el trabajo y las matriculaciones de la gente). Consulta [categorías de datos](../concepts/data-categories.md).

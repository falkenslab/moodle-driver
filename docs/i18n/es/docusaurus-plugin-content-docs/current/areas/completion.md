# Finalización

La finalización de actividades es cómo registra Moodle lo que ha hecho cada participante en un curso. Esta área cubre sus tres lados: un estudiante que marca su propia finalización manual (`setCompletion`), un profesor que anula la finalización de alguien (`overrideCompletion`) y un profesor que lee el informe de progreso del curso, la finalización de todos en todas las actividades (`completionReport`). La finalización propia de la persona en cada actividad también llega con la estructura del curso (`courseStructure`). La finalización del curso, si alguien ha completado el curso entero, va aparte: sus condiciones, el estado de cada participante y marcar a alguien como completado a mano (consulta [Finalización del curso](#course-completion)); el informe de progreso nunca es el informe de finalización del curso.

**Términos:** [finalización](../reference/glossary.md#completion), [actividad](../reference/glossary.md#activity).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

La finalización tiene que estar activada en el curso. Las reglas de cada actividad (manual, o automática al verla, al calificarla, al entregarla…) se fijan con el `completion` de `createActivity` y de `updateActivity`, y se leen de vuelta con `activitySettings` (consulta [Restricciones y finalización](activities.md#restrictions-and-completion)).

## Estados de finalización {#completion-states}

Los cuatro estados de finalización de Moodle, por nombre, se exportan como `COMPLETION_STATES` (en el orden de Moodle, de `COMPLETION_INCOMPLETE` a `COMPLETION_COMPLETE_FAIL`):

```ts
const COMPLETION_STATES = ["incomplete", "complete", "complete-pass", "complete-fail"] as const;
type CompletionState = (typeof COMPLETION_STATES)[number];
```

- `incomplete`: aún no hecha.
- `complete`: hecha.
- `complete-pass`: hecha, con una calificación de aprobado (una actividad que la exige).
- `complete-fail`: hecha, con una calificación por debajo de la de aprobado.

## setCompletion

Marca la finalización propia de la persona en una actividad con finalización manual, hecha o no hecha, como hace su botón "Marcar como hecha". Marcarla dos veces no cambia nada.

```ts
function setCompletion(context: BrowserContext, siteUrl: string, activityId: number, done: boolean): Promise<{ changed: string }>;
```

- `activityId`: el id de la actividad (id del módulo del curso) (el `id` de `courseStructure`).
- `done`: `true` para hecha, `false` para deshacerlo.

Devuelve una frase ("Activity 5 marked done."). Pasa por el servicio que usa el botón (`core_completion_update_activity_completion_status_manually`).

Lanza `CompletionError` cuando:

- la actividad se completa automáticamente (al verla, al calificarla, al entregarla…): no se puede marcar a mano;
- la finalización no está activada en el curso de la actividad;
- la persona no tiene permiso para cambiar la finalización ahí.

Cualquier otro rechazo de Moodle llega como `MoodleServiceError`, con el código de error de Moodle (consulta [Errores](../concepts/errors.md)).

Cuando un programa recorre actividades como lo haría un estudiante, el rastro descrito en [Ritmo de estudiante](../concepts/student-pace.md) deja que Moodle registre las visualizaciones (y la finalización automática al ver) como para una persona.

## overrideCompletion

Fija la finalización de otra persona en una actividad como lo hace un profesor desde el informe de progreso, y devuelve el estado que guardó Moodle.

```ts
function overrideCompletion(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  state: CompletionState,
): Promise<{ changed: string; state: CompletionState; overridden: boolean }>;
```

- `userId`: el participante (consulta [Participantes](participants.md)).
- `state`: el estado que fijar, por nombre; se envía como el número de estado de Moodle. El propio informe de progreso anula a `complete` o a `incomplete`.

Devuelve:

- `changed`: una frase ("User 4's completion of activity 6 set to complete.").
- `state`: el estado que tiene Moodle después de la anulación.
- `overridden`: si Moodle registra el estado como fijado por un profesor.

Pasa por `core_completion_override_activity_completion_status`, que requiere la capacidad de anular la finalización en el curso (los profesores la tienen por defecto). Los errores son los de `setCompletion`: `CompletionError` para la finalización no activada o no permitida, `MoodleServiceError` para cualquier otra cosa que Moodle rechace.

## completionReport

El informe de progreso de un curso (`report/progress/index.php`): la finalización de todos los participantes en todas las actividades que la registran, página a página hasta que no llegan filas nuevas, opcionalmente en un grupo.

```ts
function completionReport(context: BrowserContext, siteUrl: string, courseId: number, options?: { group?: number; userIds?: number[] }): Promise<CompletionReport>;

interface CompletionReport {
  activities: { id: number; name: string; type: string }[];
  participants: { userId: number; fullName: string; completion: CompletionCell[] }[];
}

interface CompletionCell {
  activityId: number;
  state: CompletionState;
  tracking: "manual" | "auto";
  overridden: boolean;
}
```

- `activities`: las columnas del informe, por id del módulo del curso, nombre y módulo ("page", "quiz"…), leídas de los enlaces de la cabecera.
- `userIds`: solo las filas de estas personas. El informe no tiene filtro por usuario: se leen sus páginas hasta encontrarlas a todas.
- `participants`: uno por fila, solo con el id de usuario y el nombre completo. El informe también muestra otros campos de identidad (un correo, por ejemplo): no se leen.
- `completion`: una celda por actividad, en el orden de las actividades. `tracking` dice si la actividad se completa a mano o automáticamente; `overridden` es `true` cuando la fijó un profesor, no la persona ni Moodle.

Los estados se leen de los nombres de archivo de los iconos de las celdas, nunca de sus textos, así que el informe se lee igual en cualquier idioma.

Cuando ninguna actividad registra la finalización, o no hay nadie que listar, Moodle muestra un mensaje en lugar de la tabla, y la función devuelve un informe vacío (`{ activities: [], participants: [] }`). Lanza `CompletionError` cuando la página no es el informe: el curso no existe, o la persona no puede ver su informe.

## La finalización en courseStructure {#completion-in-coursestructure}

`courseStructure` (consulta [Cursos](courses.md)) devuelve la finalización propia de la persona con cada actividad, cuando la actividad la registra para ella:

```ts
completion?: { state: CompletionState; complete: boolean };
```

`state` es uno de los cuatro estados de arriba; `complete` es el veredicto global de Moodle (una actividad puede estar hecha con `complete-fail` y aun así no contar como completada). Un profesor, o una actividad sin finalización, no tiene campo `completion`. `pendingActivities` lo usa para listar lo que queda por hacer.

## Finalización del curso {#course-completion}

La finalización del curso es otra cosa: si un participante ha completado el curso entero, según las condiciones que fijan sus ajustes de "Finalización del curso" (actividades completadas, una calificación del curso, una fecha, la marca de un profesor…). Moodle la muestra en el informe de finalización del curso (`report/completion/index.php`), no en el informe de progreso que lee `completionReport`, que es la finalización de actividades. La cubren cuatro funciones: `courseCompletionCriteria` y `setCourseCompletionCriteria` leen y fijan las condiciones, `courseCompletionStatus` lee la finalización del curso de cada participante y `markCourseComplete` marca a alguien como completado a mano. La condición de finalización del curso de una insignia ([Insignias](badges.md)) se cumple cuando se cumple esta finalización.

Moodle calcula la finalización del curso a medida que los participantes cumplen las condiciones: una actividad completada cuenta enseguida, pero algunas condiciones (una calificación del curso, una fecha, los días matriculado, otros cursos) solo las revisa su tarea programada "Calcular datos regulares de finalización" (`\core\task\completion_regular_task`, cada minuto por defecto, según la ejecuta el cron del sitio). Hasta que se ejecuta, una condición cumplida puede no aparecer todavía (confirmado empíricamente, Moodle 5.2).

## courseCompletionCriteria

Las condiciones de finalización de un curso, de su formulario de ajustes de "Finalización del curso" (`course/completion.php`).

```ts
function courseCompletionCriteria(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseCompletionCriteria>;

interface CourseCompletionCriteria {
  enabled: boolean;
  locked: boolean;
  overall: "all" | "any";
  activities?: { activityIds: number[]; all: boolean };
  courses?: { courseIds: number[]; all: boolean };
  date?: string;
  enrolmentDays?: number;
  unenrolment?: true;
  grade?: number;
  self?: true;
  roles?: { roleIds: number[]; all: boolean };
  offered: { activities: { id: number; name: string }[]; roles: { id: number; name: string }[] };
}
```

- `enabled`: si la finalización está activada en el sitio y en el curso ("Habilitar rastreo del grado de finalización" en los ajustes del curso). Moodle guarda las condiciones de todos modos, pero no registra la finalización de nadie mientras está desactivada.
- `locked`: si alguien ya ha cumplido alguna condición. Moodle bloquea entonces las condiciones: no pueden cambiar hasta desbloquearlas (consulta `setCourseCompletionCriteria`).
- `overall`: si el curso se completa cuando se cumplen todas las condiciones, o una cualquiera.
- Cada tipo de condición, solo cuando está fijada: `activities` (ids de módulos del curso, todas o una cualquiera), `courses` (otros cursos que completar antes), `date` (ISO, el comienzo de ese día en la zona horaria de la persona), `enrolmentDays` (días tras matricularse), `unenrolment`, `grade` (una calificación del curso de al menos esto), `self` (el participante lo marca él mismo) y `roles` (lo marca como completado alguien con estos roles, todos o uno cualquiera).
- `offered`: las actividades del curso con rastreo de finalización y los roles que pueden marcar a un participante como completado (los que tienen `moodle/course:markcomplete`), con sus nombres tal como los muestra el formulario.

Un formulario bloqueado muestra sus opciones solo como texto: el driver las lee por las propias cadenas de Moodle en el idioma de la persona (`core_get_strings`), y los cursos previos de un curso bloqueado, de las columnas del informe de finalización del curso. Lanza `CompletionError` cuando la persona no puede fijar las condiciones del curso (requiere `moodle/course:update`; Moodle lleva a un profesor sin permiso de edición a otra página) o el curso no existe.

## setCourseCompletionCriteria

Fija las condiciones de finalización de un curso con el mismo formulario, como lo hace un profesor, y las devuelve después.

```ts
function setCourseCompletionCriteria(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  changes: CourseCompletionChanges,
  options?: { unlock?: boolean },
): Promise<{ changed: string; criteria: CourseCompletionCriteria }>;

interface CourseCompletionChanges {
  overall?: "all" | "any";
  activities?: { activityIds: number[]; all?: boolean } | null;
  courses?: { courseIds: number[]; all?: boolean } | null;
  date?: Date | null;
  enrolmentDays?: number | null;
  unenrolment?: boolean;
  grade?: number | null;
  self?: boolean;
  roles?: { roleIds: number[]; all?: boolean } | null;
}
```

- Una condición dada sustituye los ajustes de ese tipo; `null` (o `false`) la quita; una que no se da se queda como está.
- `all` es `true` por defecto (también el valor por defecto de Moodle). El formulario solo tiene agregación de actividades con dos actividades o más.
- `date`: cuenta el día, en la zona horaria de la persona. `enrolmentDays`: una de las opciones de Moodle (de 1 a 30, de 40 a 180 de diez en diez, 365). `grade`: mayor que 0, en los puntos del total del curso.
- `unlock`: cuando las condiciones están bloqueadas, las desbloquea primero, como el botón "Desbloquear las opciones de finalización y eliminar los datos de finalización del usuario" del formulario: borra los datos de finalización del curso de todos los participantes (no su finalización de actividades).

Devuelve `changed` ("Course 7's completion criteria set: activities, grade.") y las condiciones después. Lanza `CompletionError` cuando la persona no puede fijarlas (`moodle/course:update`), cuando la finalización está desactivada en el sitio o en el curso, cuando están bloqueadas y no se da `unlock`, y para actividades o roles que el formulario no ofrece (nombrando los que sí); `FormError` con el mensaje de Moodle cuando rechaza el formulario (un curso previo que no registra la finalización).

## courseCompletionStatus

La finalización del curso de cada participante, del informe de finalización del curso: si ha completado el curso y cuándo, y cada condición cumplida y cuándo.

```ts
function courseCompletionStatus(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { userId?: number; group?: number; limit?: number; offset?: number },
): Promise<CourseCompletionStatus[]>; // ListPage<CourseCompletionStatus> con limit

interface CourseCompletionStatus {
  userId: number;
  fullName: string;
  complete: boolean;
  completedAt?: string;
  criteria: CourseCriterionStatus[];
  markable: boolean;
}

interface CourseCriterionStatus {
  type: "activity" | "course" | "date" | "duration" | "unenrolment" | "grade" | "self" | "role" | "other";
  activityId?: number;
  courseId?: number;
  name: string;
  met: boolean;
  metAt?: string;
}
```

- `userId`: solo este participante; `group`: solo los de este grupo.
- `criteria`: en el orden del informe (cursos previos, actividades y luego el resto), cada una por su tipo, el id de su actividad o curso, y su nombre tal como lo muestra el informe (el de la actividad, el del curso, el del rol).
- `markable`: si la persona puede marcarlo como completado con `markCourseComplete`.
- Sin `limit`, todos los participantes en el orden del informe (por apellido); con él, una página (consulta [Listas largas](../concepts/calling-functions.md#long-lists)). El informe se lee entero y se recorta.

Las condiciones salen de las cabeceras de las columnas del informe (las actividades y los cursos por sus enlaces, el resto por sus iconos), las fechas de su exportación CSV, como instantes en cualquier idioma. Lanza `CompletionError` cuando la persona no puede ver el informe (requiere `report/completion:view`) o el curso no tiene condiciones de finalización; un curso sin nadie que listar da `[]`. El informe muestra el estado de las condiciones aunque la finalización esté desactivada en el curso, pero entonces nada lo cambia.

## markCourseComplete

Marca a mano la finalización del curso de un participante, como lo hace el enlace del informe: la condición "Finalización manual por otros" del curso, para un rol que la persona tiene en el curso.

```ts
function markCourseComplete(context: BrowserContext, siteUrl: string, courseId: number, userId: number): Promise<{ changed: string; status: CourseCompletionStatus }>;
```

Cumplida esa condición, Moodle completa el curso cuando lo permiten las demás (una cualquiera, o todas cumplidas); con otras condiciones aún por revisar, el curso se completa la próxima vez que se ejecuta la tarea de finalización de Moodle. Un participante ya marcado se deja como está ("User 4 was already marked complete in course 7."). Devuelve su finalización después. Lanza `CompletionError` cuando la persona no puede ver el informe, cuando el curso no tiene condición de rol para un rol que tenga (requiere `moodle/course:markcomplete`), cuando la finalización no está activada y cuando el usuario no es un participante registrado.

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

// Como profesor: el curso 7 se completa cuando se hace su cuestionario final (módulo del curso 12) y el profesor lo aprueba.
await moodle.setCourseCompletionCriteria(7, { overall: "all", activities: { activityIds: [12] }, roles: { roleIds: [3] } });

// ¿Quién ha hecho el cuestionario pero aún espera al profesor? Aprobarlo.
for (const status of await moodle.courseCompletionStatus(7)) {
  const quiz = status.criteria.find((c) => c.activityId === 12);
  if (quiz?.met && !status.complete && status.markable) {
    const { changed } = await moodle.markCourseComplete(7, status.userId);
    console.log(changed);
  }
}
```

## Ejemplo {#example}

Un estudiante marca una página como hecha; un profesor lee el informe y marca como hecho un libro que un estudiante ha leído en papel.

```ts
import { CompletionError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

// Como estudiante: marcar como hechas todas las páginas manuales incompletas del curso 3.
const sections = await moodle.courseStructure(3);
for (const activity of sections.flatMap((s) => s.activities)) {
  if (activity.type !== "page" || activity.completion?.state !== "incomplete") continue;
  try {
    await moodle.setCompletion(activity.id, true);
  } catch (error) {
    if (error instanceof CompletionError) console.log(`${activity.name}: ${error.message}`);
    else throw error;
  }
}

// Como profesor: ¿quién no ha completado el libro (módulo del curso 6)?
const report = await moodle.completionReport(3);
for (const participant of report.participants) {
  const cell = participant.completion.find((c) => c.activityId === 6);
  if (cell?.state === "incomplete") console.log(participant.userId, participant.fullName);
}
const result = await moodle.overrideCompletion(6, 7, "complete");
console.log(result.changed, result.overridden);
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `setCompletion`: `own`.
- `overrideCompletion`: `others-write` (decidir sobre otra persona).
- `completionReport`: `others-personal`.
- `courseCompletionCriteria` y `setCourseCompletionCriteria`: `course-content`.
- `courseCompletionStatus`: `others-personal`.
- `markCourseComplete`: `others-write`.
- `courseStructure`: `course-content` y `own` (la finalización propia de la persona).

# Finalización

La finalización de actividades es cómo registra Moodle lo que ha hecho cada participante en un curso. Esta área cubre sus tres lados: un estudiante que marca su propia finalización manual (`setCompletion`), un profesor que anula la finalización de alguien (`overrideCompletion`) y un profesor que lee el informe de progreso del curso, la finalización de todos en todas las actividades (`completionReport`). La finalización propia de la persona en cada actividad también llega con la estructura del curso (`courseStructure`).

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
- `courseStructure`: `course-content` y `own` (la finalización propia de la persona).

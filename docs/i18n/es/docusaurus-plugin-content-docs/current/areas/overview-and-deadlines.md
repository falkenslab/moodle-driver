# Vista general y fechas límite

Esta área responde a "qué hay que hacer y qué ha cambiado": la vista general de actividades de un curso de Moodle 5 (`activitiesOverview`), las fechas límite de la persona según el calendario (`deadlines`) y lo que ha cambiado en las actividades de un curso desde una fecha (`courseUpdates`). Las tres funcionan para estudiantes y profesores; cada una muestra lo que Moodle le muestra a la persona (un estudiante ve su propia entrega y su calificación, un profesor cuántos han entregado y qué falta por calificar).

**Términos:** [actividad](../reference/glossary.md#activity), [evento del calendario](../reference/glossary.md#calendar-event).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Lo que la persona aún tiene que hacer en un curso, por finalización o por calificaciones que faltan, es `pendingActivities`, documentada en [Cursos](courses.md#pendingactivities).

## activitiesOverview

La vista general de actividades de un curso de Moodle 5 (la página "Actividades" del curso), mediante el servicio que usa esa página (`core_courseformat_get_overview_information`): por actividad, las columnas que su vista general le muestra a la persona, como la fecha de entrega, las entregas, lo que falta por calificar o su propia calificación.

```ts
function activitiesOverview(context: BrowserContext, siteUrl: string, courseId: number, type?: string): Promise<OverviewActivity[]>;

// La forma de cada actividad (el tipo se infiere, no se exporta con este nombre).
interface OverviewActivity {
  id: number;
  name: string;
  type: string;
  url?: string;
  visible: boolean;
  available?: boolean;
  fields: OverviewField[];
}

interface OverviewField {
  key: string;
  label: string;
  text: string;
  date?: string;
  url?: string;
  details?: { label: string; value: string }[];
  alert?: { label: string; count: number };
}
```

- `type`: un módulo ("assign", "quiz", "forum"…), o `"resource"` para todos los tipos de recurso a la vez (páginas, libros, archivos, carpetas, enlaces). Sin él, todos los tipos del curso: `"resource"` primero, y luego cada tipo que aún no haya traído.
- `id` es el id de módulo del curso; `visible` es `false` para una actividad oculta a los estudiantes; `available: false` aparece solo cuando la persona no puede abrirla ahora.
- `fields`: las columnas de la vista general salvo el nombre, en el orden de Moodle. `key` es la clave de columna de Moodle ("duedate", "submissions", "actions"…), estable en cualquier idioma; `label` es su encabezado en el idioma del sitio.

El `text` de cada campo es lo que muestra la celda, sea cual sea el tipo de celda que usó Moodle:

- Una fecha tiene `date` como cadena ISO, y `text` tal como la escribió Moodle ("Sunday, 20 December 11:55 PM").
- Una marca (respondida, entregada…) tiene su significado en `text`, del texto alternativo del icono.
- Un diálogo (los intentos de un cuestionario, por ejemplo) tiene el texto de su botón y sus líneas en `details`.
- Cualquier otro valor tiene su texto plano, y `url` cuando es un enlace (una acción "Ver" o "Calificar").
- `alert`: una insignia con un número, como "Necesita calificación" con 2.

Pedir un tipo que el curso no tiene, o uno sin página de vista general (las áreas de texto y medios), da una lista vacía: Moodle 5.2 responde sin actividades en lugar de con un error (comprobado empíricamente). Un curso que la persona no puede ver deja pasar el `MoodleServiceError` de Moodle. Sin tipo, se omite un tipo cuya vista general falla. La página de vista general es de Moodle 5: en sitios más antiguos el servicio no existe.

## deadlines

Lo que la persona tiene que hacer antes de una fecha, a partir de los eventos de acción del calendario (entregar, intentar, calificar…), en un curso o en todos los suyos, desde hace unos días hasta unos días por delante.

```ts
function deadlines(context: BrowserContext, siteUrl: string, options?: { courseId?: number; days?: number; pastDays?: number }): Promise<Deadline[]>;

// La forma de cada fecha límite (el tipo se infiere, no se exporta con este nombre).
interface Deadline {
  activityId?: number;
  activity: string;
  type?: string;
  event: string;
  kind: string;
  date: string;
  overdue: boolean;
  course?: { id: number; shortname?: string };
  action?: { name: string; actionable: boolean; count?: number; url?: string };
}
```

Opciones, todas ellas opcionales:

- `courseId`: un curso; sin él, todos los cursos de la persona.
- `days`: hasta dónde hacia delante, 30 por defecto.
- `pastDays`: hasta dónde hacia atrás, 7 por defecto, para que aparezca el trabajo vencido reciente.

Cada fecha límite tiene el id de módulo del curso y el nombre de la actividad, su módulo, el nombre del evento ("Essay is due") y su tipo (el tipo de evento de Moodle, como `"due"` o `"close"`), su fecha como cadena ISO y si está vencida (`overdue`). `action` es lo que la persona puede hacer al respecto ("Añadir entrega", con `url` para hacerlo); `actionable` es `false` cuando aún no se puede hacer o ya no se puede. Moodle devuelve como mucho 50 eventos por llamada.

Lee `core_calendar_get_action_events_by_course` o `core_calendar_get_action_events_by_timesort`, como hace la línea de tiempo del área personal. Moodle da a los profesores pocos eventos de acción: sus recuentos de calificación están en `activitiesOverview` (la `alert` del campo de acciones de una tarea o de un cuestionario).

## courseUpdates

Lo que ha cambiado en las actividades de un curso desde una fecha, con los nombres de las actividades del curso.

```ts
function courseUpdates(context: BrowserContext, siteUrl: string, courseId: number, since: Date): Promise<CourseUpdate[]>;

// La forma de cada cambio (el tipo se infiere, no se exporta con este nombre).
interface CourseUpdate {
  id: number;
  name?: string;
  type?: string;
  changes: { what: string; time?: string; items?: number }[];
}
```

- `id`: el id de módulo del curso de la actividad; `name` y `type` vienen del estado del curso (una actividad eliminada desde entonces no los tiene).
- `changes`: lo que Moodle informa por actividad, por el nombre de su área (`"configuration"`, `"submissions"`, `"discussions"`, `"grades"`…), con la hora del cambio cuando Moodle la da y cuántos elementos cambiaron (nuevas entregas, mensajes…).

Pasa por `core_course_get_updates_since`, el servicio que usa la app móvil de Moodle para saber qué refrescar. Solo se conservan los cambios de las actividades. Un curso que Moodle rechaza (que no existe, por ejemplo) deja pasar el `MoodleServiceError` de Moodle.

## Ejemplo {#example}

La semana de un estudiante: lo que vence en todos sus cursos y lo que ha cambiado en el curso 3 desde ayer.

```ts

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

for (const deadline of await moodle.deadlines({ days: 7, pastDays: 0 })) {
  const where = deadline.course?.shortname ?? "";
  console.log(`${deadline.date} ${where} ${deadline.activity}: ${deadline.action?.name ?? deadline.event}`);
}

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
for (const update of await moodle.courseUpdates(3, yesterday)) {
  console.log(update.name ?? update.id, update.changes.map((c) => c.what).join(", "));
}

// Como profesor: las tareas con entregas esperando calificación.
for (const activity of await moodle.activitiesOverview(3, "assign")) {
  const alert = activity.fields.find((f) => f.alert)?.alert;
  if (alert && alert.count > 0) console.log(`${activity.name}: ${alert.count} (${alert.label})`);
}
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `activitiesOverview`: `course-content`, `own` y `others-aggregate` (recuentos como "2 de 4 entregados", que no identifican a nadie).
- `deadlines`: `own`.
- `courseUpdates`: `course-content` y `others-aggregate`.
- `pendingActivities`: `own`.

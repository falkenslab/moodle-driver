# Registros e informes

Quién hizo qué en un curso, tal como lo ve un profesor en los informes de Moodle: los registros (por usuario, actividad, tipo de acción y momento), las visualizaciones de cada actividad (el informe de actividad) y quién participó en una actividad (el informe de participación). Necesitan las capacidades de los informes en el curso (`report/log:view`, `report/outline:view`, `report/participation:view`), que los profesores tienen en un sitio por defecto; un estudiante recibe un `ReportError`.

**Términos:** [registro](../reference/glossary.md#log), [actividad](../reference/glossary.md#activity), [id del módulo del curso](../reference/glossary.md#course-module-id), [rol](../reference/glossary.md#role).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

Moodle no abre ningún servicio AJAX para estos informes: se leen de las páginas de los informes, por las celdas, los enlaces y los campos de formulario de sus tablas, así que funcionan en cualquier idioma de la interfaz. Los textos que escribe Moodle (los nombres de componentes y eventos, "Módulo de curso visto") vienen en el idioma del sitio; las descripciones, en inglés, tal como las escriben los eventos. Las fechas se interpretan con el formato de fecha del propio idioma del sitio (sus cadenas `langconfig`, mediante `core_get_strings`) en la zona horaria de la persona, y vienen en ISO 8601. Todas las funciones lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## courseLogs

Los registros de un curso, del más reciente al más antiguo.

```ts
function courseLogs(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { userId?: number; activityId?: number; from?: Date; until?: Date; action?: LogAction; limit?: number; offset?: number },
): Promise<LogEntry[]>; // ListPage<LogEntry> con limit

type LogAction = "create" | "view" | "update" | "delete" | "change"; // LOG_ACTIONS

interface LogEntry {
  time?: string;
  timeText: string;
  userId?: number;
  userName: string;
  realUserId?: number;
  relatedUserId?: number;
  relatedUserName?: string;
  context: string;
  activityId?: number;
  component: string;
  event: string;
  description: string;
  origin: string;
  ip?: string;
}
```

- `userId`, `activityId` y `action` son los propios filtros del informe: los eventos de una persona, los de una actividad (por su id del módulo del curso) y un tipo de acción (`"change"` es cualquier creación, actualización o borrado).
- `from` y `until` se limitan a un intervalo de tiempo: el informe se lee página a página, del más reciente al más antiguo, y se detiene en el primer evento anterior a `from`.
- `limit`, `offset`: una página de entradas (consulta [Listas largas](../concepts/calling-functions.md#long-lists)): con `limit`, vienen como `{ items, more }`; sin él, las 100 primeras (tras `offset`) como una lista simple. Sin `until`, el informe se abre en la página que contiene `offset`; con `until`, que solo aplica el driver, se lee desde la primera página.
- Cada entrada: `time` (ISO 8601) y `timeText` tal como lo muestra el informe; quién lo hizo (`userId`, `userName`, ninguno en los eventos del sistema; `realUserId` cuando alguien actuó habiendo iniciado sesión como esa persona); sobre quién era (`relatedUserId`, `relatedUserName`: calificado, matriculado…); dónde (`context`, "Foro: Avisos", y `activityId` cuando fue una actividad); los nombres de `component` y `event`; la `description` de Moodle; `origin` (`"web"`, `"cli"`, `"ws"`…) e `ip`.

`time` solo falta cuando no se pudo interpretar el formato de fecha del sitio; en ese caso, una llamada con `from` o `until` lanza `ReportError` en lugar de adivinar. Ver el informe queda registrado a su vez, así que una página posterior puede empezar con filas ya leídas: se descartan (dos eventos idénticos y en el mismo segundo se tomarían como uno). Lanza `ReportError` cuando la persona no puede ver los registros del curso.

## activityReport

El informe de actividad de un curso: por cada actividad, sus visualizaciones.

```ts
function activityReport(context: BrowserContext, siteUrl: string, courseId: number, options?: { from?: Date; until?: Date }): Promise<ActivityViews[]>;

interface ActivityViews {
  activityId: number;
  type: string;
  name: string;
  views: number;
  users: number;
  lastAccess?: string;
}
```

- `views`: cuántas veces se vio; `users`: por cuántas personas (0 en ambos cuando nadie la vio); `lastAccess`: la última visualización (ISO 8601, al minuto), que falta cuando no hay ninguna o el sitio oculta el último acceso a la persona.
- `from` y `until` cuentan solo las visualizaciones de ese intervalo, como hace el propio filtro de fechas del informe.
- `type` es el módulo (`"page"`, `"quiz"`…), y las actividades vienen en el orden del curso.

Lanza `ReportError` cuando la persona no puede verlo.

## participationReport

Quién participó en una actividad de un curso, y quién no.

```ts
function participationReport(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  activityId: number,
  options?: { roleId?: number; since?: Date; action?: ParticipationAction },
): Promise<ActivityParticipant[]>;

type ParticipationAction = "view" | "post"; // PARTICIPATION_ACTIONS

interface ActivityParticipant {
  userId: number;
  fullName: string;
  roleId: number;
  actions: number;
}
```

- Todas las personas con el rol `roleId` en el curso (si no se indica, cada rol que ofrece el informe, uno tras otro: una persona con dos roles aparece una vez por cada uno), con `actions`, cuántas acciones hicieron en la actividad; 0 para quienes no hicieron nada.
- `action` cuenta solo las visualizaciones, o solo las publicaciones (entregar, responder, publicar); `since`, solo las acciones posteriores a esa fecha.
- Hace falta el id del curso además del de la actividad: el informe pertenece al curso.

Moodle cuenta las acciones que hicieron las personas como participantes (por la web o la app), no la edición de un profesor. Lanza `ReportError` cuando la persona no puede ver el informe, o la actividad no es del curso.

## Ejemplo {#example}

```ts
import { ReportError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  // Lo que hizo Lucía (usuario 5) en la última semana.
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  for (const entry of await moodle.courseLogs(3, { userId: 5, from: since })) {
    console.log(`${entry.time ?? entry.timeText}  ${entry.event}  ${entry.context}`);
  }

  // Actividades que nadie ha abierto todavía.
  const unseen = (await moodle.activityReport(3)).filter((activity) => activity.views === 0);
  console.log("Sin ver:", unseen.map((activity) => activity.name).join(", "));

  // Estudiantes que no han publicado en el foro (actividad 46); el rol 5 es Estudiante en este sitio.
  const silent = (await moodle.participationReport(3, 46, { roleId: 5, action: "post" })).filter((person) => person.actions === 0);
  console.log("Sin mensajes:", silent.map((person) => person.fullName).join(", "));
} catch (error) {
  if (error instanceof ReportError) console.error(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

- `courseLogs`, `participationReport`: `others-personal` (lo que hizo cada persona).
- `activityReport`: `course-content` y `others-aggregate` (recuentos que no identifican a nadie).

Consulta [Categorías de datos](../concepts/data-categories.md).

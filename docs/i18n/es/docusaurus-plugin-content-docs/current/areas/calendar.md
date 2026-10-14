# Calendario

Esta área trabaja con el calendario de Moodle: los próximos eventos de la persona (`upcomingEvents`) o un evento (`calendarEvent`), crear un evento de curso (`createEvent`), cambiar un evento (`updateEvent`) y eliminar uno (`deleteEvent`). Cualquiera puede leer sus próximos eventos; crear, cambiar y eliminar eventos de curso requiere el derecho a gestionar el calendario del curso, que los profesores tienen por defecto. Lo que la persona tiene que hacer antes de una fecha (entregar, intentar, calificar) se lee mejor con `deadlines` (consulta [Vista general y fechas límite](overview-and-deadlines.md)).

**Términos:** [evento del calendario](../reference/glossary.md#calendar-event).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## CalendarEvent

Los eventos que devuelven todas las funciones de aquí:

```ts
interface CalendarEvent {
  id: number;
  name: string;
  type: string;
  start: string;
  durationMinutes?: number;
  courseId?: number;
  activity?: { type: string; instance: number };
}
```

- `id`: el id del evento, lo que reciben `calendarEvent`, `updateEvent` y `deleteEvent`.
- `type`: el tipo de evento de Moodle: `"course"`, `"group"`, `"user"`, `"site"` o uno propio de una actividad (`"due"`, `"open"`, `"close"`…).
- `start`: una fecha ISO en UTC.
- `durationMinutes`: solo para un evento con duración.
- `courseId`: el curso al que pertenece, cuando pertenece a uno.
- `activity`: para el evento de una actividad, su módulo ("assign", "quiz"…) y su id de instancia (el id propio del módulo, no el id del módulo del curso).

## upcomingEvents

Los próximos eventos de la persona tal como los lista la vista "Próximos eventos" del calendario, en un curso o en todos sus cursos.

```ts
function upcomingEvents(context: BrowserContext, siteUrl: string, options?: { courseId?: number }): Promise<CalendarEvent[]>;
```

Sin `courseId` pide la vista del sitio (el curso 1), que trae los eventos de todos los cursos en los que está la persona, más sus eventos propios y los del sitio. Pasa por `core_calendar_get_calendar_upcoming_view`, así que tiene los límites de esa vista: Moodle usa las preferencias de calendario de la persona (cuántos días hacia delante, cuántos eventos como máximo).

## createEvent

Crea un evento de curso mediante el propio formulario de eventos del calendario, y lo devuelve tal como lo tiene el calendario.

```ts
function createEvent(
  context: BrowserContext,
  siteUrl: string,
  options: { courseId: number; name: string; start: Date; durationMinutes?: number; description?: string },
): Promise<{ changed: string; event: CalendarEvent }>;
```

- `courseId`: el curso en cuyo calendario va el evento. El evento siempre es un evento de curso (`type: "course"`), que ven todos los del curso.
- `name`: el título del evento.
- `start`: cuándo empieza, como un `Date`.
- `durationMinutes`: su duración en minutos; sin ella, el evento no tiene duración.
- `description`: HTML para la descripción del evento (`"<p>Aula 3</p>"`); se envía tal como está escrito.

Devuelve `changed`, una frase ("Event 12 "Tutorial" added to course 3's calendar."), y `event`.

Lanza `CalendarError` cuando:

- el formulario no ofrece eventos de curso para ese curso: la persona no puede añadir eventos a su calendario (un estudiante, por ejemplo);
- la validación de Moodle rechaza el formulario: el mensaje pide revisar el nombre, el inicio y la duración.

### La hora de inicio y las zonas horarias {#the-start-time-and-time-zones}

Un formulario de Moodle muestra las fechas en la zona horaria de la persona (la de su perfil, o la del sitio), como campos separados para el día, el mes, el año, la hora y el minuto. Rellenarlos a partir de un `Date` obligaría a convertirlo antes a esa zona horaria. `createEvent` lo evita: pide a Moodle el formulario de eventos ya abierto en la hora de inicio (el `starttime` del fragmento del formulario, una marca de tiempo Unix, como cuando la persona pulsa un día del calendario), así que los campos de fecha llegan rellenados por el propio Moodle para el instante de `start`, sea cual sea la zona horaria de la persona o del programa.

`event.start` vuelve como una fecha ISO en UTC: dale formato en la zona horaria de la persona (`readPageConfig()` la devuelve como `timeZone`) cuando se la muestres.

## calendarEvent

Un evento por su id, con la misma forma en que los da `upcomingEvents`, mediante `core_calendar_get_calendar_event_by_id`.

```ts
function calendarEvent(context: BrowserContext, siteUrl: string, eventId: number): Promise<CalendarEvent>;
```

Lanza `CalendarError` cuando no existe ese evento o la persona no puede verlo: Moodle responde igual en los dos casos.

## updateEvent

Cambia un evento mediante el propio formulario del calendario, abierto sobre el evento (como hace su "Editar"): solo cambia lo que se da. Devuelve el evento tal como lo tiene el calendario después.

```ts
function updateEvent(context: BrowserContext, siteUrl: string, eventId: number, changes: EventChanges): Promise<{ changed: string; event: CalendarEvent }>;

interface EventChanges {
  name?: string;
  description?: string;
  start?: Date;
  durationMinutes?: number;
  until?: Date;
  location?: string;
  wholeSeries?: boolean;
}
```

- `name`, `description` (HTML, enviado tal como está escrito), `location`: sustituyen lo que tiene el evento.
- `start`: el nuevo inicio. El evento conserva su duración: un evento de 45 minutos movido a otro día sigue durando 45 minutos.
- `durationMinutes`: la nueva duración en minutos, `0` para ninguna; `until`: el nuevo final en su lugar. No las dos.
- `wholeSeries`: para un evento de una serie repetida, si el cambio se aplica a todos los eventos de la serie o solo a este. Sin ella, se aplica lo predeterminado de Moodle: toda la serie. Se ignora en un evento que no se repite.

A diferencia de `createEvent`, el formulario abierto sobre un evento muestra las fechas del propio evento, así que `start` y `until` se rellenan en la zona horaria de la persona (leída de Moodle, como la da `readPageConfig()`), como ella las escribiría.

Lanza `CalendarError` cuando no existe ese evento, cuando la persona no puede cambiarlo (el evento de una actividad, que cambia con los ajustes de la actividad, o el de otra persona) y cuando la validación de Moodle rechaza los cambios (un final antes del inicio, un inicio antes del del curso); un `MoodleError` con el código `invalid-input` cuando se dan a la vez `durationMinutes` y `until`, o el nombre está vacío. Sin nada que cambiar, no abre ningún formulario y responde `"Nothing to change."` con el evento tal como está.

El formulario del calendario contiene los campos de todos los tipos de evento (el curso y el grupo de un evento de grupo, la categoría de un evento de categoría): `createEvent` y `updateEvent` envían solo los del tipo propio del evento, como la página de Moodle muestra solo esos. Fuera de la página, la lista de grupos del formulario sigue teniendo su primer grupo, y Moodle lo guardaría en un evento de curso, que entonces solo vería ese grupo (comprobado empíricamente, Moodle 5.2).

## deleteEvent

Elimina un evento del calendario que la persona puede gestionar.

```ts
function deleteEvent(context: BrowserContext, siteUrl: string, eventId: number): Promise<{ changed: string }>;
```

Pasa por `core_calendar_delete_calendar_events`, un evento (no el resto de una serie que se repite). Lanza `CalendarError` cuando no existe ese evento (ya eliminado, o que nunca existió). Otros rechazos, como un evento que la persona no tiene permiso para eliminar, pasan como el `MoodleServiceError` de Moodle (consulta [Errores](../concepts/errors.md)). Los eventos de una actividad (la fecha de entrega de una tarea) pertenecen a la actividad: cambian con sus ajustes.

## Ejemplo {#example}

Un profesor añade una tutoría de 45 minutos al curso 3, la mueve dos días más tarde, lista los próximos eventos del curso y la vuelve a quitar.

```ts
import { CalendarError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

try {
  const { event } = await moodle.createEvent({
    courseId: 3,
    name: "Tutoría: recursividad",
    start: new Date("2026-11-04T16:00:00Z"),
    durationMinutes: 45,
    description: "<p>Aula 3, trae tus ejercicios.</p>",
  });
  console.log(`Creado ${event.id} a las ${event.start}`);

  // Dos días más tarde, misma duración, en otra aula.
  const moved = await moodle.updateEvent(event.id, { start: new Date("2026-11-06T16:00:00Z"), location: "Aula 4" });
  console.log(moved.changed);

  for (const upcoming of await moodle.upcomingEvents({ courseId: 3 })) {
    console.log(upcoming.start, upcoming.type, upcoming.name);
  }

  await moodle.deleteEvent(event.id);
} catch (error) {
  if (error instanceof CalendarError) console.log(error.message);
  else throw error;
}
```

## Categorías de datos {#data-categories}

De `DATA_CATEGORIES` (consulta [Categorías de datos](../concepts/data-categories.md)):

- `upcomingEvents`: `own` y `course-content` (los eventos propios de la persona y los que fijan los profesores en los cursos).
- `calendarEvent`: `own` y `course-content`, como `upcomingEvents`.
- `createEvent`, `updateEvent`, `deleteEvent`: `course-content`.

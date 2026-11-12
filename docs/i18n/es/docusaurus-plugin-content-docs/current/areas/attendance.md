# Asistencia

Actividades de asistencia (módulo `attendance`, el plugin mod_attendance), tal como las usan los profesores: sus sesiones añadidas (una, o semanales entre dos fechas), listadas, cambiadas y eliminadas, la asistencia tomada en una sesión, y el informe con los recuentos y porcentajes de cada participante. La actividad en sí se crea con `createActivity({ type: "attendance", … })` (consulta [Actividades y secciones](activities.md)), con sus ajustes por los nombres de su formulario (`groupmode: 1` o `2` para sesiones de grupo, `grade`…).

**Términos:** [asistencia](../reference/glossary.md#attendance), [id del módulo del curso](../reference/glossary.md#course-module-id).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos.

Ninguno de los servicios del plugin está abierto a AJAX (son de la aplicación móvil): el driver trabaja con las propias páginas del plugin, la página de sesiones, los formularios para añadir y actualizar una sesión, la confirmación de eliminar, la página para tomar asistencia y el informe, leídas por sus campos, enlaces y datos, así que funciona en cualquier idioma de la interfaz. Todas las funciones lanzan `NotAnAttendanceError` cuando el id no es una actividad de asistencia que la persona pueda abrir, `AttendanceError` cuando Moodle lo rechaza (con el mensaje de Moodle y la capacidad que requiere) o no existe una sesión o una marca, y `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)). Comprobado con la versión 2026042102 del plugin en Moodle 5.2; en Moodle 4.5 funciona la versión del plugin para 4.5, aún sin comprobar.

## attendanceSessions

Las sesiones de una actividad de asistencia, por fecha.

```ts
function attendanceSessions(context: BrowserContext, siteUrl: string, activityId: number): Promise<AttendanceSession[]>;

interface AttendanceSession {
  id: number;
  start?: string;
  durationMinutes?: number;
  when: string;
  groupId?: number;
  description: string;
  taken: boolean;
}
```

- Lo que muestra la página de sesiones: todas las sesiones desde la fecha de inicio del curso, de los grupos que ve la persona. Moodle oculta las sesiones anteriores a la fecha de inicio del curso (y las deja fuera del informe).
- `start` (ISO 8601) y `durationMinutes` salen del formulario para actualizar cada sesión, que solo abre quien puede cambiar sesiones (`mod/attendance:manageattendances`, los profesores). Un profesor sin permiso de edición recibe solo `when`: la fecha y la hora como las muestra la página, en el idioma de la persona.
- `groupId`: el grupo para el que es la sesión; no aparece en una sesión para todos los estudiantes. `description`: HTML (`""` cuando no tiene; el "Sin descripción" de Moodle para quien no puede abrir su formulario).
- `taken`: se ha tomado asistencia en ella.
- Requiere `mod/attendance:takeattendances` (los profesores la tienen); un estudiante recibe `AttendanceError`.

## addAttendanceSessions

Añade sesiones con el formulario para añadir una sesión: una, o una en cada día de la semana indicado hasta una fecha.

```ts
function addAttendanceSessions(context: BrowserContext, siteUrl: string, activityId: number, input: AttendanceSessionInput): Promise<AttendanceSessionsAdded>;

interface AttendanceSessionInput {
  start: Date;
  durationMinutes: number;
  description?: string;
  groupIds?: number[];
  repeatOn?: AttendanceWeekday[];
  repeatUntil?: Date;
  repeatEveryWeeks?: number;
}

type AttendanceWeekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

interface AttendanceSessionsAdded {
  changed: string;
  sessionIds: number[];
  sessions: AttendanceSession[];
}
```

- El formulario toma una fecha y una hora de inicio y de fin en la zona horaria de la persona en Moodle: el driver escribe `start` en esa zona, y una sesión debe terminar el día en que empieza (si no, `MoodleError` `invalid-input`, antes de enviar nada).
- `repeatOn`: una sesión en cada uno de esos días de la semana desde la semana de `start` hasta `repeatUntil` (ese día incluido), cada `repeatEveryWeeks` semanas (1 por defecto, hasta 36, como ofrece el formulario), todas a la hora del día de `start`; `repeatUntil` va con él. La validación de Moodle rechaza una repetición cuyos días de la semana nunca caen entre las dos fechas (`FormError`).
- `groupIds`: una sesión por cada grupo, en una actividad con modo de grupo; `AttendanceError` cuando la actividad no usa grupos, y cuando usa grupos separados y no se indica ninguno.
- Los demás ajustes del formulario (un evento del calendario, que los estudiantes registren su propia asistencia…) quedan como los ponen los valores por defecto de Moodle.
- Devuelve las sesiones añadidas, leídas de nuevo de la página de sesiones. Requiere `mod/attendance:manageattendances` (los profesores); `AttendanceError` cuando Moodle no lista ninguna (un inicio anterior a la fecha de inicio del curso).

## editAttendanceSession

Cambia una sesión con su formulario para actualizarla: solo lo indicado.

```ts
function editAttendanceSession(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number, changes: AttendanceSessionChanges): Promise<AttendanceSessionChange>;

interface AttendanceSessionChanges {
  start?: Date;
  durationMinutes?: number;
  description?: string;
}

interface AttendanceSessionChange {
  changed: string;
  sessionId: number;
  session?: AttendanceSession;
}
```

- Un `start` nuevo mantiene la duración de la sesión salvo que se indique otra; un `durationMinutes` nuevo mantiene su inicio.
- Moodle no pasa una sesión a otro grupo.
- Requiere `mod/attendance:manageattendances`; `AttendanceError` para una sesión que no es de la actividad.

## deleteAttendanceSession

Elimina una sesión con su confirmación de eliminar, como hace el icono de eliminar de la página de sesiones.

```ts
function deleteAttendanceSession(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<AttendanceSessionChange>;
```

- La asistencia tomada en la sesión se va con ella, y Moodle recalcula las calificaciones de la actividad.
- Requiere `mod/attendance:manageattendances`; `AttendanceError` para una sesión que no es de la actividad.

## sessionAttendance

La asistencia de una sesión, como la muestra su página para tomar asistencia.

```ts
function sessionAttendance(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<SessionAttendance>;

interface SessionAttendance {
  sessionId: number;
  statuses: AttendanceStatus[];
  participants: SessionParticipant[];
}

interface AttendanceStatus {
  id: number;
  acronym: string;
  description: string;
}

interface SessionParticipant {
  userId: number;
  fullName: string;
  statusId?: number;
  status?: string;
  remarks: string;
  canMark: boolean;
}
```

- `statuses`: el conjunto de estados de la sesión, como lo define la actividad (el de Moodle por defecto es Presente, Ausente, Retraso y Justificado, `P`, `A`, `L`, `E`), los que muestra la actividad.
- `participants`: todos aquellos para los que es la sesión (los de su grupo, en una sesión de grupo), de todas las páginas de participantes de Moodle; `status` (el acrónimo) y `statusId` cuando están marcados, y sus observaciones. `canMark` es false para quien tiene la matriculación terminada o suspendida antes de la sesión: Moodle no muestra opciones para ellos.
- Requiere `mod/attendance:takeattendances`; `AttendanceError` para una sesión que no es de la actividad.

## takeAttendance

Toma asistencia en una sesión con su página para tomar asistencia.

```ts
function takeAttendance(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number, marks: AttendanceMark[]): Promise<AttendanceTaken>;

interface AttendanceMark {
  userId: number;
  status: number | string;
  remarks?: string;
}

interface AttendanceTaken {
  changed: string;
  sessionId: number;
  attendance: SessionAttendance;
}
```

- `status`: un estado del conjunto de la sesión, por id, acrónimo (`"P"`, y luego sin distinguir mayúsculas) o nombre (`"Absent"`, sin distinguir mayúsculas). El conjunto se lee de la página, nunca se supone.
- Todas las marcas se comprueban antes de guardar nada: un estado que no es del conjunto, un participante que la sesión no lista o que no se puede marcar, rechaza la llamada entera con `AttendanceError`, que nombra cada problema y los estados del conjunto.
- Los participantes no indicados conservan lo que tienen; las `remarks` (observaciones) se dejan como están cuando no se indican.
- Moodle marca la sesión como tomada y recalcula la calificación de la actividad. Devuelve la asistencia de la sesión después.
- Requiere `mod/attendance:takeattendances`, y `mod/attendance:changeattendances` cuando la sesión ya está tomada (los profesores tienen las dos).

## attendanceReport

El informe de la actividad, como lo muestra su vista de resumen: una fila por participante.

```ts
function attendanceReport(context: BrowserContext, siteUrl: string, activityId: number, options?: AttendanceReportOptions): Promise<AttendanceReportRow[]>;

interface AttendanceReportOptions {
  groupId?: number;
}

interface AttendanceReportRow {
  userId: number;
  fullName: string;
  statuses: { acronym: string; count: number; percentage: number }[];
  taken: AttendancePoints;
  all: AttendancePoints;
  maxPossible: AttendancePoints;
}

interface AttendancePoints {
  sessions?: number;
  points: number;
  maxPoints: number;
  percentage: number;
}
```

- `statuses`: cuántas de las sesiones tomadas del participante tienen cada estado, y eso como porcentaje de sus sesiones tomadas (con un decimal), en el orden de las columnas del informe.
- `taken`: sobre las sesiones tomadas para él, cuántas, los puntos obtenidos de los posibles y el porcentaje: lo que califica Moodle. `all`: lo mismo sobre todas las sesiones, tomadas o no. `maxPossible`: los puntos y el porcentaje que alcanzaría asistiendo a todas las sesiones aún no tomadas.
- Los puntos salen de la calificación de cada estado en el conjunto de estados (Presente 2, Retraso y Justificado 1, Ausente 0 por defecto).
- `groupId`: solo los participantes de ese grupo. Se leen todas las páginas de participantes de Moodle.
- Requiere `mod/attendance:viewreports` (los profesores la tienen).

## Ejemplo {#example}

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const activityId = 72;

// Lunes y miércoles a las 10:00, 90 minutos, durante el cuatrimestre.
const { sessionIds } = await moodle.addAttendanceSessions(activityId, {
  start: new Date("2027-02-01T10:00:00+01:00"),
  durationMinutes: 90,
  description: "<p>Clase</p>",
  repeatOn: ["Mon", "Wed"],
  repeatUntil: new Date("2027-05-26T12:00:00+02:00"),
});
console.log(`${sessionIds.length} sesiones añadidas`);

// Todos presentes en la primera, salvo un estudiante ausente.
const first = await moodle.sessionAttendance(activityId, sessionIds[0]!);
await moodle.takeAttendance(
  activityId,
  sessionIds[0]!,
  first.participants.filter((p) => p.canMark).map((p) => ({ userId: p.userId, status: p.userId === 41 ? "A" : "P" })),
);

// Quién tiene ausente más del 20% de sus sesiones tomadas.
for (const row of await moodle.attendanceReport(activityId)) {
  const absent = row.statuses.find((s) => s.acronym === "A");
  if (absent && absent.percentage > 20) console.log(`${row.fullName}: ${absent.count} ausencias (${absent.percentage}%)`);
}
```

## Categorías de datos {#data-categories}

`attendanceSessions`, `addAttendanceSessions` y `editAttendanceSession` son `course-content`; `deleteAttendanceSession` es `course-content` y `others-write`, porque la asistencia tomada en la sesión se va con ella; `sessionAttendance` y `attendanceReport` son `others-personal`; `takeAttendance` es `others-personal` y `others-write`. Consulta [Categorías de datos](../concepts/data-categories.md).

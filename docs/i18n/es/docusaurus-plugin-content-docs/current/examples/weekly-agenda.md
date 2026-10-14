# Una agenda semanal {#a-weekly-agenda}

Un programa para un estudiante que imprime su semana de un vistazo: los cursos en marcha, lo que vence en los próximos 7 días (con el trabajo atrasado señalado), lo que aún tiene pendiente en cada curso y cuántas notificaciones están sin leer.

**Usa:** [cursos](../areas/courses.md), [vista general y fechas límite](../areas/overview-and-deadlines.md), [mensajes](../areas/messages.md).

## El programa {#the-program}

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
});

// La primera vez se abre una ventana para que la persona inicie sesión; las siguientes ejecuciones reutilizan la sesión guardada.
const me = await moodle.logIn();
console.log(`Agenda de ${me.fullName}\n`);

// "inprogress" filtra por las fechas de los cursos, como hace la vista general de cursos del área personal.
const courses = await moodle.listCourses("inprogress");
console.log(`Cursos en marcha (${courses.length}):`);
for (const course of courses) {
  // progress solo está cuando el curso sigue la finalización.
  const progress = course.progress !== undefined ? ` - ${Math.round(course.progress)}% completado` : "";
  console.log(`  ${course.shortname}  ${course.fullname}${progress}`);
}

// Los eventos de acción del calendario en todos los cursos: 7 días hacia delante, y 7 hacia atrás para que el trabajo aún sin hacer salga como atrasado.
// Un evento que Moodle da por hecho (una tarea entregada) deja de ser un evento de acción.
const deadlines = await moodle.deadlines({ days: 7, pastDays: 7 });
console.log(`\nFechas límite:`);
for (const deadline of deadlines) {
  const when = new Date(deadline.date).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const flag = deadline.overdue ? "ATRASADA " : "";
  console.log(`  ${flag}${when}  [${deadline.course?.shortname ?? "?"}] ${deadline.activity}: ${deadline.action?.name ?? deadline.event}`);
}
if (deadlines.length === 0) console.log("  Nada que entregar.");

// Trabajo pendiente por curso: actividades sin completar o, donde no se sigue la finalización, actividades calificables aún sin calificación.
// Lee la página del curso y el informe de calificaciones, así que tarda unos segundos por curso.
console.log(`\nPendiente:`);
for (const course of courses) {
  const { pending } = await moodle.pendingActivities(course.id);
  if (pending.length === 0) continue;
  console.log(`  ${course.shortname} (${pending.length})`);
  for (const activity of pending) {
    const locked = activity.availableToMe ? "" : " (aún no disponible)";
    console.log(`    [${activity.type}] ${activity.name}${locked}`);
  }
}

const unread = await moodle.notifications({ unreadOnly: true });
console.log(`\nNotificaciones sin leer: ${unread.length}`);
// Aquí se cierra el navegador: `await using` llama a moodle.close(), que además guarda la sesión.
```

## Paso a paso {#step-by-step}

1. `createMoodle` solo apunta el sitio y las opciones del navegador; no se abre nada hasta la primera llamada que necesita el navegador. `await using` cierra el navegador cuando termina el programa, también si hay un error.
2. `logIn()` responde al instante cuando el perfil tiene una sesión. La primera vez abre una ventana del navegador en la página de acceso del sitio y espera (cinco minutos por defecto) mientras la persona inicia sesión allí; el driver nunca ve la contraseña.
3. `listCourses("inprogress")` da los cursos cuyas fechas incluyen hoy. El `id` de cada curso es lo que reciben las demás funciones de cursos.
4. `deadlines({ days: 7, pastDays: 7 })` lee los mismos eventos de acción que la línea de tiempo del área personal, en todos los cursos a la vez. Cada uno tiene su `date` en ISO, si está `overdue`, su curso y lo que la persona puede hacer con él (`action.name`, como "Agregar entrega").
5. `pendingActivities(course.id)` enumera, por curso, lo que la persona aún tiene que hacer. Abre la página del curso y el informe de calificaciones, así que es la parte más lenta.
6. `notifications({ unreadOnly: true })` lee la lista del desplegable de notificaciones; su longitud es el número del contador.

## Lo que imprime {#what-it-prints}

Un ejemplo; los nombres, las fechas y los textos vienen del sitio, en su idioma.

```text
Agenda de Ada Lovelace

Cursos en marcha (3):
  PROG101  Programación 101 - 45% completado
  MATH110  Matemática discreta - 70% completado
  HIST205  Historia de la informática

Fechas límite:
  ATRASADA mié, 7 oct, 23:59  [MATH110] Boletín 3: Agregar entrega
  lun, 12 oct, 09:00  [PROG101] Cuestionario 2: Intente resolver el cuestionario ahora
  vie, 16 oct, 23:59  [PROG101] Ejercicios de recursividad: Agregar entrega

Pendiente:
  PROG101 (3)
    [quiz] Cuestionario 2
    [assign] Ejercicios de recursividad
    [page] Lecturas complementarias (aún no disponible)
  MATH110 (1)
    [assign] Boletín 3

Notificaciones sin leer: 4
```

## Variaciones {#variations}

- Un solo curso: `moodle.deadlines({ courseId: 3, days: 7 })`.
- Solo lo que está por venir, sin lo atrasado: `pastDays: 0`.
- Mostrar las propias notificaciones sin leer: `for (const n of unread) console.log(n.subject, n.url ?? "")`, y marcarlas como leídas después con `await moodle.markNotificationsRead()`.
- En un sitio con Moodle 5, `moodle.activitiesOverview(course.id, "assign")` añade las fechas de entrega y el estado de las entregas que muestra la página "Actividades" del curso.

## Cuando algo sale mal {#when-something-goes-wrong}

- `LoginTimeoutError` o `LoginWindowClosedError` de `logIn()`: nadie inició sesión a tiempo, o se cerró la ventana. Vuelve a ejecutarlo.
- `NoDisplayError`: hacía falta una ventana de inicio de sesión en una máquina sin pantalla. Inicia sesión una vez donde haya una, con el mismo perfil.
- `NotLoggedInError` de cualquier llamada posterior: Moodle cerró la sesión entretanto. Llama de nuevo a `moodle.logIn()` y repite la llamada.
- `MoodleServiceError` de `listCourses` o `deadlines`: el servicio falló; `error.errorcode` tiene el motivo de Moodle. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

Todo aquí es de la propia persona (`own`): `listCourses`, `deadlines`, `pendingActivities` y `notifications`; `logIn` es `none`. Consulta [categorías de datos](../concepts/data-categories.md).

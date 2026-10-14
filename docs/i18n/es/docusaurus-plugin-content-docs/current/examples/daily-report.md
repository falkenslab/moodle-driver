# Un informe diario {#a-daily-report}

Un programa para que un profesor lo ejecute cada mañana: sus notificaciones sin leer, las fechas límite de la semana que viene, lo que ha cambiado en un curso desde ayer y los debates más recientes del foro del curso con sus respuestas. Solo lee; en Moodle no cambia nada.

**Usa:** [mensajes](../areas/messages.md), [vista general y fechas límite](../areas/overview-and-deadlines.md), [foros](../areas/forums.md).

## El programa {#the-program}

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

const COURSE_ID = 3; // course/view.php?id=3, o listCourses()
const FORUM_ID = 37; // el id de actividad del foro: mod/forum/view.php?id=37, o courseStructure(COURSE_ID)
const DAY = 24 * 60 * 60 * 1000;
const yesterday = new Date(Date.now() - DAY);
const short = (text: string) => text.replace(/\s+/g, " ").slice(0, 90);

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
const me = await moodle.logIn();
console.log(`Informe diario de ${me.fullName}, ${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`);

// Leerlas no las marca como leídas: la campana las sigue mostrando en Moodle.
const unread = await moodle.notifications({ unreadOnly: true });
console.log(`\nNotificaciones sin leer: ${unread.length}`);
for (const n of unread) console.log(`  [${n.component ?? "sitio"}] ${n.subject}`);

// Los eventos de acción del calendario en todos los cursos, de hoy a una semana vista.
console.log("\nFechas límite de esta semana:");
for (const d of await moodle.deadlines({ days: 7, pastDays: 0 })) {
  console.log(`  ${d.date.slice(0, 16)} ${d.course?.shortname ?? ""} ${d.activity}: ${d.action?.name ?? d.event}`);
}

// Lo que pregunta la app móvil de Moodle para saber qué refrescar: por actividad, qué ha cambiado y cuántos elementos.
console.log(`\nCambios en el curso ${COURSE_ID} desde ayer:`);
for (const update of await moodle.courseUpdates(COURSE_ID, yesterday)) {
  const changes = update.changes.map((c) => (c.items ? `${c.what} (${c.items})` : c.what)).join(", ");
  console.log(`  ${update.name ?? `actividad ${update.id}`}: ${changes}`);
}

// La lista del foro no viene con lo más reciente primero (fijados arriba, después por último mensaje): se ordena por fecha de inicio.
const discussions = await moodle.forumDiscussions(FORUM_ID);
const newest = discussions.filter((d) => d.started).sort((a, b) => b.started!.localeCompare(a.started!)).slice(0, 3);
console.log("\nDebates más recientes del foro:");
for (const d of newest) {
  console.log(`  ${d.subject}, de ${d.author} (${d.replies} respuestas)`);
  // Los más antiguos primero: el primer mensaje abre el debate, el resto son las respuestas.
  const { posts } = await moodle.discussion(d.id);
  for (const post of posts.slice(1)) console.log(`    ${post.author.fullName}: ${short(post.text)}`);
}
```

## Paso a paso {#step-by-step}

1. `COURSE_ID` y `FORUM_ID` salen de las páginas del curso (el `id` de cada URL) o de `listCourses()` y `courseStructure(COURSE_ID)`. El id del foro es su id de actividad, no el id de la instancia del foro.
2. `logIn()` devuelve el id y el nombre de la persona; la primera vez abre una ventana para iniciar sesión, y luego nunca más mientras dure la sesión. Si se ejecuta desde un planificador (cron, una tarea programada), la sesión ya tiene que estar guardada en el perfil, porque no hay nadie para iniciar sesión.
3. `notifications({ unreadOnly: true })` lee las notificaciones de la campana: mensajes del foro, entregas, calificaciones... `component` dice qué envió cada una (`mod_forum`, `mod_assign`) en cualquier idioma. Leerlas no las marca como leídas.
4. `deadlines` lee los eventos de acción del calendario en todos los cursos del profesor, como hace la línea de tiempo del área personal. Moodle da pocos a los profesores (las tareas por calificar aparecen cuando toca calificarlas), así que la lista puede ser corta.
5. `courseUpdates` pregunta a Moodle qué ha cambiado en cada actividad desde ayer: entregas nuevas, mensajes del foro, calificaciones, configuración. Los nombres salen de la estructura del curso.
6. `forumDiscussions` enumera los debates del foro recorriendo todas sus páginas; el programa los ordena por fecha de inicio y toma los tres más recientes. `discussion` lee los mensajes de cada uno, los más antiguos primero, así que todos menos el primero son respuestas.

## Lo que imprime {#what-it-prints}

Una ejecución de ejemplo:

```text
Informe diario de Ada Profesora, lunes, 9 de noviembre de 2026

Notificaciones sin leer: 2
  [mod_forum] Re: Ejercicio 3: ¿termina el bucle?
  [mod_assign] Alan Turing ha enviado una tarea

Fechas límite de esta semana:
  2026-11-12T22:59 PROG1 Ensayo sobre recursividad: Calificar
  2026-11-13T18:00 PROG1 Cuestionario de la unidad 4: El cuestionario se cierra

Cambios en el curso 3 desde ayer:
  Ensayo sobre recursividad: submissions (3)
  Foro del curso: discussions (2)

Debates más recientes del foro:
  Ejercicio 3: ¿termina el bucle?, de Grace Hopper (2 respuestas)
    Alan Turing: Termina cuando i llega a 2, la condición se comprueba primero.
    Grace Hopper: Gracias, tenía la condición al revés.
  Fechas de examen, de Ada Profesora (0 respuestas)
```

## Variaciones {#variations}

- Varios cursos: recorre `listCourses("inprogress")` y llama a `courseUpdates(course.id, yesterday)` para cada uno.
- Lo que hay por calificar: `activitiesOverview(COURSE_ID, "assign")` da el recuento "Pendiente de calificar" de cada tarea en el `alert` de sus campos.
- Vaciar la campana después de leer: `await moodle.markNotificationsRead()` las marca todas como leídas, como hace "Marcar todas como leídas".
- Solo los debates de hoy: filtra por `d.started! >= yesterday.toISOString()` en vez de tomar los tres más recientes.

## Cuando algo sale mal {#when-something-goes-wrong}

- `NotLoggedInError`: la sesión caducó. En una ejecución programada no hay nadie para iniciar sesión: ejecuta el programa una vez a mano (se abre una ventana), y después la planificación sigue funcionando. Consulta [Iniciar sesión](../getting-started/logging-in.md).
- `NoDisplayError`: hacía falta una ventana de inicio de sesión en una máquina sin pantalla; inicia sesión una vez donde haya una, con el mismo perfil.
- `MoodleServiceError` de `courseUpdates`: Moodle rechazó el curso (no existe, o la persona no está en él).
- `NotAForumError`: `FORUM_ID` no es un foro que el profesor pueda ver; toma el id de `courseStructure(COURSE_ID)`. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`notifications` y `deadlines` son del propio profesor (`own`); `courseUpdates` es `course-content` y `others-aggregate` (recuentos que no identifican a nadie); `forumDiscussions` y `discussion` son `others-personal`, porque contienen nombres y mensajes de estudiantes. No escribe nada ni envía mensajes a nadie. Consulta [Categorías de datos](../concepts/data-categories.md).

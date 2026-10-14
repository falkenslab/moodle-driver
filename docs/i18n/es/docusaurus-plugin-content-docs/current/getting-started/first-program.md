# Tu primer programa

Un script completo que inicia sesión, lista los cursos de la persona, lee la estructura de un curso y lo que aún tiene pendiente en él, e imprime sus calificaciones. Guárdalo como `first.mjs` (o `.ts` con `tsx`), define `MOODLE_URL` y ejecútalo.

```ts
import { createMoodle, NotLoggedInError } from "@falkenslab/moodle-driver";

const moodle = createMoodle({
  site: process.env.MOODLE_URL ?? "https://campus.example.org/",
  profileDir: `${process.env.HOME}/.my-moodle-profile`,
  headless: true,
  downloadBrowser: true,
});

try {
  // 1. Una sesión: una ventana la primera vez, ninguna después.
  const me = await moodle.logIn({ timeoutMs: 5 * 60_000 });
  console.log(`Hola, ${me.fullName}`);

  // 2. Los cursos en curso de la persona.
  const courses = await moodle.listCourses("inprogress");
  if (courses.length === 0) throw new Error("No hay cursos en curso.");
  const course = courses[0]!;
  console.log(`\n${course.fullname} (${course.id})`);

  // 3. Secciones y actividades, con la finalización de la persona.
  const sections = await moodle.courseStructure(course.id);
  for (const section of sections) {
    console.log(`  ${section.title}`);
    for (const activity of section.activities) console.log(`    [${activity.type}] ${activity.name}${activity.completion?.complete ? " (hecha)" : ""}`);
  }

  // 4. Lo que queda por hacer.
  const { pending } = await moodle.pendingActivities(course.id);
  console.log(`\nPendiente: ${pending.map((p) => p.name).join(", ") || "nada"}`);

  // 5. Calificaciones, tal como las muestra el informe del usuario.
  const grades = await moodle.myGrades(course.id);
  for (const row of grades.filter((r) => r.kind === "item")) console.log(`  ${row.name}: ${row.grade ?? "-"}`);
} catch (error) {
  if (error instanceof NotLoggedInError) console.error("La sesión ha terminado: vuelve a ejecutarlo para iniciar sesión.");
  else throw error;
} finally {
  // Guarda las cookies de sesión y cierra el navegador.
  await moodle.close();
}
```

## Qué ocurre {#what-happens}

1. `createMoodle` todavía no abre nada: el navegador arranca con la primera llamada que lo necesita, y solo una vez.
2. `logIn` abre una ventana la primera vez; la persona inicia sesión; la ventana se cierra. La próxima vez vuelve al momento.
3. Cada método trabaja en su propia pestaña del mismo navegador, con la sesión de la persona, y la cierra.
4. Los resultados son objetos simples: números, cadenas, fechas ISO. Nada que cerrar ni liberar.
5. `close()` guarda la sesión y cierra el navegador. Llámalo siempre, en un `finally`.

## Siguientes pasos {#next-steps}

- Lee [Cómo funciona](../concepts/how-it-works.md) para saber qué hace el driver en Moodle en cada llamada.
- Lee [El objeto Moodle y las funciones](../concepts/calling-functions.md) para conocer las convenciones que sigue toda operación.
- Elige un área: [tareas](../areas/assignments.md), [cuestionarios](../areas/quizzes.md), [foros](../areas/forums.md), [calificación](../areas/grading.md)…
- Si tu programa actúa como estudiante (leer contenido, responder cuestionarios), lee [Trabajar al ritmo de un estudiante](../concepts/student-pace.md).

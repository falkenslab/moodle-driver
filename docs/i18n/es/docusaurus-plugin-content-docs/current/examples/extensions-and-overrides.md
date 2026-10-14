# Dar más tiempo a un estudiante {#give-a-student-more-time}

Un programa para un profesor que da más tiempo a un estudiante: una ampliación del plazo de una tarea, una semana después de la fecha que tenía, y una excepción de un cuestionario con una fecha de cierre posterior, un límite de tiempo más largo y un intento más.

**Usa:** [calificación](../areas/grading.md), [cuestionarios](../areas/quizzes.md), [participantes](../areas/participants.md).

## El programa {#the-program}

```ts
import { createMoodle, FormError, NotAnAssignmentError, QuizError } from "@falkenslab/moodle-driver";

// Los ids, de las páginas del curso o del driver:
const COURSE_ID = 3; // course/view.php?id=3, o listCourses()
const ASSIGNMENT_ID = 45; // mod/assign/view.php?id=45, o courseStructure(COURSE_ID)
const QUIZ_ID = 27; // mod/quiz/view.php?id=27
const STUDENT_ID = 7; // user/view.php?id=7, o participants(COURSE_ID)
const WEEK = 7 * 24 * 60 * 60 * 1000;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();

// Asegúrate de que el id es la persona correcta antes de cambiar sus fechas.
const student = (await moodle.participants(COURSE_ID)).find((p) => p.userId === STUDENT_ID);
if (!student) throw new Error(`El usuario ${STUDENT_ID} no es participante del curso ${COURSE_ID}.`);
console.log(`Más tiempo para ${student.fullName}`);

// La fecha de entrega del estudiante tal como está: una ampliación o excepción anterior ya cuenta en ella.
// Sin contenido es una petición por participante, sin paneles de calificación.
const submission = (await moodle.assignmentSubmissions(ASSIGNMENT_ID, { includeContent: false })).find((s) => s.userId === STUDENT_ID);
if (!submission?.dueDate) throw new Error(`La tarea ${ASSIGNMENT_ID} no tiene fecha de entrega para el usuario ${STUDENT_ID}.`);
// Una semana después de la fecha que tiene; el selector de fecha de Moodle guarda minutos, no segundos.
const until = new Date(Date.parse(submission.extensionDueDate ?? submission.dueDate) + WEEK);

try {
  console.log((await moodle.grantExtension(ASSIGNMENT_ID, [STUDENT_ID], until)).changed);
} catch (error) {
  // Moodle rechaza una fecha anterior a la fecha de entrega de la tarea, con su mensaje por campo.
  if (error instanceof FormError) console.error(error.fields.map((f) => `${f.field}: ${f.message}`).join("\n"));
  else if (error instanceof NotAnAssignmentError) console.error(error.message);
  else throw error;
}

try {
  // Solo cambia lo que se da; la fecha de apertura sigue siendo la del cuestionario.
  const override = await moodle.setQuizOverride(QUIZ_ID, STUDENT_ID, {
    close: new Date("2026-11-20T22:00:00Z"),
    timeLimitMinutes: 60,
    attempts: 2,
  });
  console.log(override.changed);
} catch (error) {
  // También cuando el estudiante ya tiene una excepción en este cuestionario: esa se cambia en Moodle.
  if (error instanceof QuizError || error instanceof FormError) console.error(error.message);
  else throw error;
}
```

## Paso a paso {#step-by-step}

1. Los ids del principio salen de las páginas del curso (cada uno es el `id` de la URL) o del driver: `listCourses()` para el curso, `courseStructure(COURSE_ID)` para las actividades (su `id` es el id del módulo del curso que reciben las funciones), `participants(COURSE_ID)` para el estudiante.
2. `logIn()` vuelve al instante con una sesión guardada, o abre una ventana para que el profesor inicie sesión la primera vez.
3. `participants` confirma que el id de usuario es un participante y da su nombre para el registro: cambiar las fechas de alguien por un id equivocado es fácil que pase inadvertido.
4. `assignmentSubmissions` con `includeContent: false` lee las fechas de todos los participantes, con sus excepciones y ampliaciones aplicadas. El programa toma la fecha actual del estudiante (la de una ampliación, si ya tenía una) y le suma una semana.
5. `grantExtension` rellena el formulario de ampliación de la tarea, como "Conceder ampliación del plazo" en la página de entregas. La fecha se escribe en la zona horaria del profesor en Moodle, así que `until` es el momento exacto. Volver a concederla sustituye una ampliación anterior. El estudiante ve la nueva fecha en la página de la tarea.
6. `setQuizOverride` añade una excepción de usuario desde la página "Excepciones" del cuestionario: una fecha de cierre, un límite de tiempo de 60 minutos y 2 intentos en total, solo para este estudiante. El resto de la configuración del cuestionario se queda como está.
7. Cada escritura responde con su frase `changed`, que el programa imprime. `await using` cierra el navegador al final.

## Lo que imprime {#what-it-prints}

Una ejecución de ejemplo:

```text
Más tiempo para Ada Lovelace
Extension until 2026-11-13T22:59:00.000Z granted to user 7 in assignment 45.
Override for user 7 in quiz 27: closes 2026-11-20T22:00:00.000Z, 60 minutes, 2 attempts.
```

## Variaciones {#variations}

- Varios estudiantes a la vez: `grantExtension(ASSIGNMENT_ID, [7, 9, 12], until)` concede la misma fecha a todos, como hace la acción en lote; las excepciones de un cuestionario son una llamada por estudiante.
- Comprobar que la ampliación se aplicó: vuelve a leer las entregas e imprime el `extensionDueDate` del estudiante.
- Intentos ilimitados: `attempts: 0`. Solo una fecha de apertura posterior: `{ open: new Date("2026-11-16T08:00:00Z") }`.
- Un grupo entero: `participants(COURSE_ID, { group: groupId })` da los ids de usuario para `grantExtension`, con el id del grupo sacado de `groups(COURSE_ID)`.

## Cuando algo sale mal {#when-something-goes-wrong}

- `FormError` de `grantExtension`: Moodle rechazó el formulario, por ejemplo una fecha anterior a la fecha de entrega de la tarea, con su mensaje en `error.fields`. También cuando la zona horaria del profesor en Moodle no es una que el driver conozca.
- `NotAnAssignmentError`: no se puede abrir el formulario de ampliación: el id no es una tarea, o la persona no tiene permiso para conceder ampliaciones.
- `QuizError` de `setQuizOverride`: el id no es un cuestionario al que la persona pueda añadir excepciones, o el estudiante no puede tener una: no es participante, o ya tiene una excepción en este cuestionario. El formulario de Moodle solo añade excepciones; cambia una existente en la página "Excepciones" de Moodle.
- `FormError` de `setQuizOverride`: Moodle rechazó los valores, como una fecha de cierre anterior a la de apertura.
- `NotLoggedInError`: la sesión caducó; vuelve a ejecutarlo para iniciar sesión. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`participants` y `assignmentSubmissions` leen datos de otros (`others-personal`); `grantExtension` y `setQuizOverride` son `others-write`: el programa cambia lo que un estudiante puede hacer. Consulta [Categorías de datos](../concepts/data-categories.md).

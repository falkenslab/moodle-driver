# Calificar las entregas pendientes {#grade-pending-submissions}

Un programa para un profesor que recorre las entregas de una tarea que esperan calificación, muestra el contenido de cada una en el terminal y guarda la calificación y la retroalimentación que escribe el profesor, notificando al estudiante. Un segundo programa hace lo mismo con una tarea calificada con una rúbrica.

**Usa:** [calificación](../areas/grading.md), [archivos](../areas/files.md).

## El programa {#the-program}

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, FormError, GradingError } from "@falkenslab/moodle-driver";

// El id de actividad de la tarea: el `id` de mod/assign/view.php?id=45, o las actividades de courseStructure().
const ASSIGNMENT_ID = 45;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();
const terminal = createInterface({ input: process.stdin, output: process.stdout });

// Un panel de calificación por participante con entrega: lento en un curso grande, pero trae el contenido.
const submissions = await moodle.assignmentSubmissions(ASSIGNMENT_ID);
// `needsGrading` es el "Requiere calificación" de Moodle: enviada, y sin calificar desde entonces.
const pending = submissions.filter((s) => s.needsGrading);
console.log(`${pending.length} de ${submissions.length} entregas por calificar.`);

let graded = 0;
for (const submission of pending) {
  console.log(`\n== ${submission.fullName} (usuario ${submission.userId}), ${submission.status}`);
  // Una entrada por plugin de entrega: las palabras del texto en línea, los enlaces de los archivos subidos.
  for (const { plugin, text, files } of submission.content ?? []) {
    if (text) console.log(`[${plugin}]\n${text}`);
    for (const file of files) console.log(`[${plugin}] ${file.name}: ${file.url}`);
  }

  const grade = (await terminal.question("Calificación (vacío para saltar): ")).trim();
  if (!grade) continue;
  const comment = (await terminal.question("Retroalimentación: ")).trim();
  try {
    const result = await moodle.gradeSubmission(ASSIGNMENT_ID, submission.userId, {
      // Tal como se escribe: "7.5", o "7,5" en un sitio que escribe los decimales con coma.
      grade,
      ...(comment ? { feedback: `<p>${comment}</p>` } : {}),
      // Moodle notifica al estudiante que hay retroalimentación en la tarea.
      notify: true,
    });
    console.log(`${result.changed} Calificación actual: ${result.grade ?? "-"}`);
    graded++;
  } catch (error) {
    // Una calificación fuera de rango, o un valor que el formulario de Moodle rechaza: se informa y se sigue con la siguiente.
    if (error instanceof GradingError || error instanceof FormError) console.error(`No se ha guardado: ${error.message}`);
    else throw error;
  }
}

terminal.close();
console.log(`\nCalificadas ${graded} de ${pending.length}.`);
```

## Paso a paso {#step-by-step}

1. `ASSIGNMENT_ID` es el id de actividad de la tarea (id del módulo del curso): el número de su URL, `mod/assign/view.php?id=45`, o el `id` de la actividad en `courseStructure(courseId)`.
2. `logIn()` vuelve al instante cuando el perfil tiene una sesión. La primera vez se abre una ventana del navegador en la página de acceso del sitio y el profesor inicia sesión allí; consulta [Iniciar sesión](../getting-started/logging-in.md).
3. `assignmentSubmissions` enumera todos los participantes, con el estado, las fechas y, para las entregas enviadas y en borrador, el contenido por plugin de entrega. Lee un participante cada vez, así que un curso de 100 estudiantes tarda un rato.
4. El programa se queda con las entregas que según Moodle requieren calificación e imprime cada una: el texto en línea como texto plano, y los archivos subidos como enlaces (descárgalos con `moodle.downloadFile(url, folder)` para abrirlos).
5. El profesor escribe una calificación, o nada para saltar a ese estudiante, y un comentario. `gradeSubmission` rellena el panel del calificador para ese estudiante, lo envía como lo hace el calificador de Moodle y vuelve a leer el panel: `result.grade` es la calificación guardada.
6. Con `notify: true`, Moodle notifica al estudiante que se ha publicado retroalimentación (por su mensajería, en la siguiente ejecución del cron del sitio). La calificación pasa al libro de calificaciones salvo que la tarea use un flujo de trabajo de calificación que aún no la haya publicado.
7. `await using` cierra el navegador (y guarda la sesión) cuando termina el programa, también tras un error.

## Lo que imprime {#what-it-prints}

Una ejecución de ejemplo:

```text
3 de 24 entregas por calificar.

== Ada Lovelace (usuario 7), submitted
[onlinetext]
Una función recursiva necesita un caso base. En mi solución el caso base es n = 0...
Calificación (vacío para saltar): 8.5
Retroalimentación: Caso base claro; falta el análisis de complejidad.
Graded user 7 in assignment 45, with feedback. Calificación actual: 8.50

== Alan Turing (usuario 9), submitted
[file] recursividad.pdf: https://campus.example.org/pluginfile.php/312/assignsubmission_file/submission_files/88/recursividad.pdf?forcedownload=1
Calificación (vacío para saltar):

== Grace Hopper (usuario 12), submitted
[onlinetext]
He usado un bucle en vez de recursividad porque...
Calificación (vacío para saltar): 11
Retroalimentación: Bien.
No se ha guardado: Moodle didn't save the grade: ... Check the grade is within the assignment's range or scale, and the fields' names.

Calificadas 1 de 3.
```

## Con una rúbrica {#with-a-rubric}

Una tarea calificada con una rúbrica recibe un nivel por criterio en lugar de una calificación. `rubric()` da los criterios y sus niveles con los ids que recibe `gradeSubmission`; Moodle calcula la calificación a partir de los niveles elegidos.

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, FormError, GradingError } from "@falkenslab/moodle-driver";

// Una tarea cuyo método de calificación es una rúbrica (su página "Calificación avanzada").
const ASSIGNMENT_ID = 52;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();
const terminal = createInterface({ input: process.stdin, output: process.stdout });

// Se lee una vez: los criterios son los mismos para todos los estudiantes.
const definition = await moodle.rubric(ASSIGNMENT_ID);
if (definition.method !== "rubric") throw new Error(`La tarea ${ASSIGNMENT_ID} se califica con "${definition.method}", no con una rúbrica.`);

for (const submission of (await moodle.assignmentSubmissions(ASSIGNMENT_ID)).filter((s) => s.needsGrading)) {
  console.log(`\n== ${submission.fullName}`);
  for (const { text } of submission.content ?? []) if (text) console.log(text);

  // Id del criterio -> id del nivel, elegido por el número del nivel tal como se enumera.
  const levels: Record<number, number> = {};
  for (const criterion of definition.criteria) {
    console.log(`\n${criterion.description}`);
    criterion.levels?.forEach((level, i) => console.log(`  ${i + 1}. (${level.score}) ${level.definition}`));
    const choice = Number(await terminal.question("Nivel: "));
    const level = criterion.levels?.[choice - 1];
    if (level) levels[criterion.id] = level.id;
  }
  // Moodle rechaza una rúbrica con un criterio sin nivel: mejor saltar al estudiante.
  if (Object.keys(levels).length < definition.criteria.length) {
    console.log("No todos los criterios tienen nivel: se salta.");
    continue;
  }
  try {
    const result = await moodle.gradeSubmission(ASSIGNMENT_ID, submission.userId, { rubric: levels, feedback: "<p>Consulta la rúbrica para cada criterio.</p>", notify: true });
    // La calificación que Moodle calculó a partir de los niveles, tal como la tiene el libro de calificaciones.
    console.log(`${result.changed} Libro de calificaciones: ${result.gradebookGrade ?? "-"}`);
  } catch (error) {
    if (error instanceof GradingError || error instanceof FormError) console.error(`No se ha guardado: ${error.message}`);
    else throw error;
  }
}
terminal.close();
```

`rubric()` lee el formulario de calificación del primer participante de la tarea, así que la tarea necesita al menos uno. El `score` de un nivel son los puntos que le da la rúbrica; la calificación que Moodle escribe en el libro de calificaciones son esos puntos escalados a la calificación máxima de la tarea, y por eso lo que hay que mostrar es el `gradebookGrade` del resultado. Un criterio también puede llevar una observación: `remarks: { [criterion.id]: "Falta el caso base." }` junto a `rubric`.

## Variaciones {#variations}

- Calificar a partir de una lista que preparó el profesor en vez del terminal: un `Map` del id de usuario a la calificación y el comentario, y `gradeSubmission` para cada entrada, sin preguntas.
- Solo mirar, sin calificar: `assignmentSubmissions(ASSIGNMENT_ID, { includeContent: false })` es mucho más rápido cuando solo hacen falta los estados y las fechas.
- Calificar sin avisar: `notify: false` guarda la calificación sin notificar al estudiante, para una primera pasada que revisar antes de publicar.
- Una guía de evaluación en vez de una rúbrica: `definition.method === "guide"`, y `guide: { [criterion.id]: score }` con cada puntuación hasta el `maxScore` del criterio.

## Cuando algo sale mal {#when-something-goes-wrong}

- `NotAnAssignmentError`: el id no es una tarea, o la persona no puede calificarla (un estudiante, o un profesor de otro curso). Comprueba el id de la actividad y el rol del profesor en el curso.
- `GradingError`: Moodle no guardó la calificación, y su servicio no dice por qué. Normalmente es una calificación fuera del rango de la tarea (11 cuando el máximo es 10) o que no está en su escala. `rubric()` también lo lanza con una tarea sin participantes.
- `FormError`: un campo no está en el formulario de calificación, como `grade` en una tarea calificada por rúbrica, o un id de criterio o de nivel que no existe; `error.fields` dice cuál.
- `MoodleError` con código `not-available`: se dio `feedback` y la tarea tiene desactivados los comentarios de retroalimentación. No se guardó nada: califica sin `feedback`, o activa los comentarios de retroalimentación en la configuración de la tarea.
- `NotLoggedInError`: la sesión caducó a mitad; vuelve a ejecutarlo, y `logIn()` abre la ventana. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`assignmentSubmissions` lee el trabajo de los estudiantes (`others-personal`), `rubric` es `course-content`, y `gradeSubmission` es `others-personal` y `others-write`: el programa decide algo sobre otras personas y Moodle se lo comunica. Consulta [Categorías de datos](../concepts/data-categories.md).

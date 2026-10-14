# Enviar una tarea {#submit-an-assignment}

Un programa para un estudiante que consulta una tarea, guarda un texto en línea y un archivo en su entrega y la envía para calificar, preguntando antes a la persona cuando el sitio quiere que acepte una declaración de entrega.

**Usa:** [tareas](../areas/assignments.md), [archivos](../areas/files.md).

## El programa {#the-program}

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, SubmissionError } from "@falkenslab/moodle-driver";

// El id del módulo del curso de la tarea: una actividad de tipo "assign" en courseStructure(), o listAssignments().
const ASSIGNMENT_ID = 45;
// Los archivos locales van como rutas absolutas.
const FILE = "/home/ada/trabajo/factorial.py";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
});
await moodle.logIn();

const assignment = await moodle.studentAssignment(ASSIGNMENT_ID);
for (const row of [...assignment.dates, ...assignment.status]) console.log(`${row.label}: ${row.value}`);

// canEdit: la página ofrece añadir o editar la entrega ahora (aún no enviada, sin pasar la fecha de corte).
if (!assignment.canEdit) {
  console.log("\nLa entrega no se puede cambiar ahora.");
} else {
  // Guarda un borrador: el texto en línea sustituye al que hubiera, el archivo se añade a los que ya había.
  const saved = await moodle.saveSubmission(ASSIGNMENT_ID, {
    onlineText: "<p>Mi factorial es recursivo, con 0 como caso base. El archivo lleva las pruebas.</p>",
    files: [FILE],
  });
  console.log(`\n${saved.changed} Archivos: ${saved.assignment.submittedFiles.map((f) => f.name).join(", ")}`);

  // canSubmit: la tarea pide a los estudiantes pulsar "Enviar tarea", y hay un borrador que enviar.
  // Donde no lo pide, Moodle ya dio por enviado el borrador guardado.
  if (saved.assignment.canSubmit) {
    try {
      console.log((await moodle.submitForGrading(ASSIGNMENT_ID)).changed);
    } catch (error) {
      // Con canSubmit a true, un SubmissionError aquí es la declaración del sitio; su mensaje lleva el texto.
      if (!(error instanceof SubmissionError)) throw error;
      console.log(`\n${error.message}`);
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await prompt.question("¿Aceptas esta declaración? (sí/no) ");
      prompt.close();
      if (/^s(í|i)?$/i.test(answer.trim())) {
        const submitted = await moodle.submitForGrading(ASSIGNMENT_ID, { acceptStatement: true });
        console.log(`${submitted.changed} Estado: ${submitted.assignment.submissionState}`);
      } else {
        console.log("No se ha enviado: el borrador sigue guardado y se puede enviar más tarde.");
      }
    }
  }
}
```

## Paso a paso {#step-by-step}

1. `logIn()` abre una ventana la primera vez para que la persona inicie sesión, y después responde al instante.
2. `studentAssignment(ASSIGNMENT_ID)` lee la tarea tal como la muestra la página del estudiante. `dates` y `status` son pares de etiqueta y valor en el idioma del sitio; `submissionState`, `canEdit` y `canSubmit` no dependen de él.
3. `saveSubmission` abre la página de edición, sube el archivo como lo hace el selector de archivos, pone el texto en línea a través de su editor y guarda. Devuelve `changed` y la tarea tal como queda, así que no hace falta volver a leerla.
4. `submitForGrading` abre la página de confirmación. Cuando el sitio pide aceptar una declaración ("Este trabajo es mío…") no envía nada y lanza `SubmissionError` con el texto de la declaración: el programa lo muestra y pregunta a la persona en el terminal.
5. Solo si la persona responde que sí vuelve a llamar con `{ acceptStatement: true }`, que marca la declaración y envía. Una vez enviada, la entrega no se puede editar salvo que el profesor la devuelva a borrador.

## Lo que imprime {#what-it-prints}

Un ejemplo en un sitio con declaración de entrega; las etiquetas y los valores vienen del sitio.

```text
Fecha de entrega: viernes, 16 de octubre de 2026, 23:59
Estatus de la entrega: No se ha enviado nada en esta tarea
Estatus de calificación: Sin calificar
Tiempo restante: 6 días 12 horas

Saved online text and 1 file in assignment 45's submission. Archivos: factorial.py

Submitting asks to accept this statement; call again with acceptStatement once the person agrees: Este trabajo es mío, excepto donde he reconocido el uso de las obras de otras personas.
¿Aceptas esta declaración? (sí/no) sí
Submitted assignment 45 for grading. Estado: submitted
```

## Variaciones {#variations}

- Solo un archivo, o solo texto: da `files` u `onlineText` por separado; una tarea que no admite uno de los dos lanza `SubmissionError` antes de guardar nada.
- Comprobar los archivos antes de abrir nada, para avisar pronto a la persona: `await checkLocalFiles([FILE])` (exportada).
- Guardar un borrador y parar: quita `submitForGrading`; el profesor lo ve como borrador.
- Descargar antes los archivos adjuntos a la descripción: `for (const f of assignment.descriptionFiles) await moodle.downloadFile(f.url, "/home/ada/trabajo")`.

## Cuando algo sale mal {#when-something-goes-wrong}

- `SubmissionError` de `studentAssignment`: el id no es una tarea que la persona pueda abrir. Tómalo de la estructura del curso (módulo `"assign"`).
- `SubmissionError` de `saveSubmission`: no se dio nada, la entrega no se puede editar ahora (ya enviada, pasada la fecha de corte) o la tarea no admite archivos o texto en línea.
- `SubmissionError` de `submitForGrading`: la declaración que aceptar, como arriba, o nada que enviar (sin borrador, ya enviada). El `code` es `submission` en todos los casos; comprobar antes `canSubmit` es lo que deja la declaración como el caso esperable.
- `MoodleError` con código `invalid-input` o `not-found`: la ruta del archivo no es absoluta o no hay ningún archivo allí, algo que se comprueba antes de abrir nada.
- `FormError`: la subida falló (demasiado grande, un tipo que la tarea no acepta, ningún repositorio de subida en el sitio) o Moodle rechazó el formulario; `error.fields` tiene los mensajes de Moodle. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`studentAssignment` es `course-content` y `own`; `saveSubmission` y `submitForGrading` son `own`. Consulta [categorías de datos](../concepts/data-categories.md).

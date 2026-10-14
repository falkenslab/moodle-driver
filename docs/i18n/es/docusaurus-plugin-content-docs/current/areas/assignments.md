# Tareas

El lado del estudiante en una tarea: leerla como la muestra la página del estudiante, guardar una entrega (texto en línea, archivos o ambos) y enviarla para calificar. Todo pasa por las propias páginas y formularios de la tarea (`mod/assign/view.php`), como lo haría la persona, así que Moodle lo registra y aplica sus propias reglas (fechas, fecha límite, intentos, la declaración de entrega). El lado del profesor (las entregas de todos, la calificación, las ampliaciones del plazo) está en [calificar](grading.md); el id de una tarea viene de la [estructura del curso](courses.md) o de `listAssignments`.

**Términos:** [tarea](../reference/glossary.md#assignment), [entrega](../reference/glossary.md#submission).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## studentAssignment

La tarea tal como la muestra la página del estudiante.

```ts
function studentAssignment(context: BrowserContext, siteUrl: string, activityId: number): Promise<StudentAssignment>;

interface StudentAssignment {
  description: string;
  descriptionFiles: { name: string; url: string }[];
  dates: { label: string; value: string }[];
  status: { label: string; value: string }[];
  submissionState?: string;
  graded: boolean;
  submittedFiles: { name: string; url: string }[];
  feedback: { label: string; value: string }[];
  feedbackFiles: { name: string; url: string }[];
  canEdit: boolean;
  canSubmit: boolean;
  group?: { id?: number; name: string };
}
```

- `description`: la descripción de la tarea como texto.
- `descriptionFiles`: los archivos adjuntos a la descripción (enlaces `pluginfile.php`, para [downloadFile](files.md)).
- `dates`: las fechas de la actividad tal como las muestra la página (`{ label: "Due", value: "Friday, 30 October 2026, 11:59 PM" }`).
- `status`: la tabla de estado de la entrega, fila a fila (número de intento, estado de la entrega, estado de la calificación, tiempo restante, última modificación…), con etiquetas y valores tal como los muestra la página.
- `submissionState`: el estado de Moodle para la entrega, leído de la clase de la celda de estado en cualquier idioma: `"new"`, `"draft"`, `"submitted"`, `"reopened"`…; ausente cuando la página no tiene ninguno.
- `graded`: el estado de la calificación dice que está calificada.
- `submittedFiles`: los archivos de la entrega de la persona.
- `feedback`: la tabla de retroalimentación, fila a fila (calificación, calificado el, calificado por, comentarios de retroalimentación), cuando hay retroalimentación.
- `feedbackFiles`: los archivos que el profesor adjuntó a la retroalimentación (un PDF corregido, un comentario de audio), enlaces `pluginfile.php` para [downloadFile](files.md); se leen del bloque del plugin de archivos de retroalimentación, así que los enlaces de los comentarios de retroalimentación no están entre ellos.
- `canEdit`: la página ofrece añadir o editar la entrega ahora.
- `canSubmit`: la página ofrece enviarla para calificar ahora (un borrador en una tarea que pide a los estudiantes pulsar el botón de enviar).
- `group`: presente cuando la tarea admite entregas en grupo, así que la entrega es del grupo: lo que un miembro guarda y envía es de todos, y el profesor puede calificarlos a todos a la vez. `name` es el grupo que nombra la página; `id` viene de la página de participantes del curso cuando le muestra el grupo a la persona; los miembros son datos de otros, que da `participants(courseId, { group: id })`. Para un estudiante sin grupo, es el "Grupo predeterminado" de Moodle, solo por nombre.

Las etiquetas y los valores están en el idioma del sitio; `submissionState`, `graded`, `canEdit`, `canSubmit` y `group` no dependen de él (la fila del grupo no tiene clase propia, así que su etiqueta se compara con la propia cadena de Moodle en el idioma de la persona, de `core_get_string`).

Con el flujo de trabajo de calificación, la calificación y la retroalimentación aparecen en `feedback` (y `graded` pasa a true) solo cuando el profesor las publica; hasta entonces el estado de la calificación dice el estado del flujo de trabajo.

Lanza `SubmissionError` cuando el id no es una tarea que la persona pueda abrir (Moodle muestra la página de otro módulo o un error), y `NotLoggedInError` sin sesión.

## saveSubmission

Guarda el texto en línea de la entrega y añade archivos, como hace "Guardar cambios" en la página de edición, y devuelve lo que guardó (`changed`) y la tarea después.

```ts
function saveSubmission(context: BrowserContext, siteUrl: string, activityId: number, input: { onlineText?: string; files?: string[] }): Promise<{ changed: string; assignment: StudentAssignment }>;
```

- `onlineText`: HTML, que sustituye el texto en línea mediante su editor.
- `files`: rutas locales absolutas, subidas al área de archivos de la entrega como lo hace el selector de archivos; los archivos que ya hay se quedan (consulta [archivos](files.md)).

Guarda un borrador: en una tarea que pide a los estudiantes pulsar el botón de enviar, la entrega sigue siendo un borrador hasta `submitForGrading`. En una que no lo pide, Moodle toma la entrega guardada como enviada.

Errores (`SubmissionError` salvo que se diga otra cosa):

- No se da ni texto en línea ni archivos.
- La página de edición no se puede abrir: ya enviada, pasada su fecha límite, o no le corresponde entregarla a la persona.
- Archivos dados a una tarea que no admite entregas de archivos, o texto en línea a una que no lo admite; no se guarda nada.
- Un `MoodleError` (`invalid-input`, `not-found`) cuando la ruta de un archivo no es absoluta o no existe, comprobado antes de abrir nada.
- `FormError` cuando la subida falla (el sitio no tiene activado ningún repositorio de subida, un archivo demasiado grande o de un tipo que la tarea no acepta) o Moodle rechaza el formulario, con sus mensajes por campo.

## submitForGrading

Envía para calificar la entrega guardada y devuelve `changed` y la tarea después.

```ts
function submitForGrading(context: BrowserContext, siteUrl: string, activityId: number, options?: { acceptStatement?: boolean } | boolean): Promise<{ changed: string; assignment: StudentAssignment }>;
```

Algunos sitios piden a los estudiantes aceptar una declaración antes de enviar ("Esta entrega es mi propio trabajo…"). Cuando el formulario de confirmación tiene esa declaración y `acceptStatement` no es `true` (es `false` por defecto; también se acepta un booleano solo, como antes de la 0.2), no se envía nada y lanza `SubmissionError` con el texto de la declaración, para que el programa pueda mostrársela a la persona y volver a llamar con `{ acceptStatement: true }` una vez que esté de acuerdo. Sin declaración, `acceptStatement` se ignora.

Lanza `SubmissionError` cuando no hay nada que enviar ahora: no hay borrador, ya está enviada, o la tarea no pide a los estudiantes pulsar el botón de enviar. Lo averigua en la página de la tarea (`canSubmit`, su botón "Enviar tarea") antes de enviar: Moodle muestra su confirmación incluso para una entrega ya enviada. Una tarea enviada no se puede volver a editar salvo que el profesor la devuelva a borrador o la reabra.

## Ejemplo {#example}

```ts
import { SubmissionError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

const assignment = await moodle.studentAssignment(45);
console.log(assignment.description);
for (const date of assignment.dates) console.log(`${date.label}: ${date.value}`);

if (assignment.canEdit) {
  const { assignment: saved } = await moodle.saveSubmission(45, {
    onlineText: "<p>Mi factorial es recursivo, con 0 como caso base.</p>",
    files: ["/home/ada/work/factorial.py"],
  });
  console.log(saved.submissionState, saved.submittedFiles.map((f) => f.name));

  if (saved.canSubmit) {
    try {
      await moodle.submitForGrading(45);
    } catch (error) {
      if (!(error instanceof SubmissionError)) throw error;
      // El sitio pide aceptar una declaración: muéstrala y pregunta a la persona antes de volver a llamar.
      console.log(error.message);
    }
  }
}
```

## Categorías de datos {#data-categories}

`studentAssignment` es `course-content` y `own`; `saveSubmission` y `submitForGrading` son `own`. Consulta [categorías de datos](../concepts/data-categories.md).

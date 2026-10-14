# Cuestionarios

Cuestionarios desde los dos lados. Un estudiante lee la página de un cuestionario, empieza o continúa un intento, responde sus preguntas página a página (al ritmo de una persona por defecto) y lo termina, y después lee la revisión. Un profesor lee todos los intentos con su calificación y la puntuación de cada pregunta (y las respuestas dadas), califica a mano lo que Moodle no puede calificar por sí mismo (ensayos) o sobrescribe una puntuación, lee qué preguntas contiene un cuestionario, añade preguntas de un banco (elegidas o aleatorias), las quita y las mueve, fija sus puntuaciones, páginas y secciones, y da a un estudiante otras fechas, un límite de tiempo o más intentos con una excepción de usuario. Los cuestionarios se identifican por su id del módulo del curso (el `id` de `mod/quiz/view.php?id=`), y los intentos, por el id de intento de Moodle.

**Términos:** [cuestionario](../reference/glossary.md#quiz), [intento](../reference/glossary.md#attempt), [slot](../reference/glossary.md#slot), [revisión](../reference/glossary.md#review), [excepción](../reference/glossary.md#override).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Todo se lee de las propias páginas de Moodle por su estructura (ids del body, nombres de formulario, clases, enlaces), así que funciona en cualquier idioma de la interfaz; los textos como fechas, estados y calificaciones vienen tal como los muestra el sitio, en su idioma. Todas las funciones lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)); los demás errores son `QuizError`, y `FormError` cuando hay un formulario de por medio.

## quizInfo

Lo que dice la página del cuestionario: su descripción, sus líneas de información, sus fechas, los intentos de la persona y si puede empezar uno.

```ts
function quizInfo(context: BrowserContext, siteUrl: string, activityId: number): Promise<QuizInfo>;

interface QuizInfo {
  intro: string;
  info: string[];
  dates: Detail[];
  feedback?: string;
  attempts: { id: number; inProgress: boolean; details: Detail[] }[];
  canStart: boolean;
  messages: string[];
}

interface Detail {
  label: string;
  value: string;
}
```

- `intro`: la descripción del cuestionario como texto.
- `info`: las líneas que hay debajo, tal como se muestran ("Intentos permitidos: 3", "Método de calificación: Calificación más alta").
- `dates`: las fechas de la actividad (apertura, cierre), cada una como una etiqueta y su valor tal como se muestra.
- `feedback`: la retroalimentación global para la calificación de la persona, cuando la página muestra una.
- `attempts`: los intentos de la persona, cada uno con su id, si sigue en curso, y sus filas de resumen (estado, calificación, puntuaciones...) como etiqueta y valor.
- `canStart`: la página tiene el botón para empezar un intento (o continuar el que está en curso).
- `messages`: lo que dice la página sobre hacer intentos (no se permiten más intentos, cerrado...).

Lanza `QuizError` cuando el id no es un cuestionario que la persona pueda abrir. No deja más rastro que abrir la página del cuestionario.

## startQuizAttempt

Empieza un intento, o continúa el que está en curso, exactamente como lo hace el botón de la página del cuestionario, y da sus preguntas.

```ts
function startQuizAttempt(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ changed: string; attemptId: number; questions: Question[] }>;
```

Un cuestionario con límite de tiempo pide primero confirmación: Moodle muestra su formulario en un diálogo en la página del cuestionario (o como una página propia cuando se pulsa el botón antes de que el script de la página esté listo); el driver lo confirma en ambos casos, lo que pone en marcha el reloj. Un cuestionario pensado para una ventana emergente segura abre el intento en una ventana nueva, que el driver cierra en cuanto tiene el id del intento. Un cuestionario con contraseña no se empieza: el driver nunca escribe una contraseña, así que `QuizError` dice que la pide y la persona empieza ese intento en Moodle. `QuizError` también llega cuando la página no tiene botón para empezar (la persona agotó los intentos, el cuestionario está cerrado), con los mensajes de la página, cuando Moodle rechaza el intento (con su mensaje), y cuando el id no es un cuestionario.

## Las preguntas y sus campos {#questions-and-their-fields}

Las preguntas de un intento o de una revisión vienen como objetos `Question`, leídos del formulario de la página:

```ts
interface Question {
  slot: number;
  page?: number;
  number?: string;
  type: string;
  state: string;
  mark?: string;
  text: string;
  images: string[];
  fields: QuestionField[];
  feedback?: string;
  rightAnswer?: string;
  comment?: string;
}

interface QuestionField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
  value?: string;
}
```

- `slot`: el lugar de la pregunta en el cuestionario; las respuestas se dan por slot.
- `page`: la página del intento en la que está (desde 0); se rellena al leer un intento, no una revisión.
- `number`: el número que se muestra ("1", "i" para una descripción).
- `type`: el tipo de pregunta de Moodle ("truefalse", "multichoice", "match", "shortanswer"...).
- `state`: la clase de estado de Moodle ("notyetanswered", "answersaved", y en una revisión "correct", "incorrect", "partiallycorrect"...).
- `mark`: la línea de la puntuación tal como se muestra ("Se puntúa como 1,00 sobre 1,00").
- `text`: el enunciado de la pregunta, sin lo que solo reciben los lectores de pantalla; `images` contiene las URL de sus imágenes.
- `feedback` y `rightAnswer`: en una revisión, cuando las opciones de revisión del cuestionario los muestran.
- `comment`: en una revisión, el comentario del profesor al calificar a mano, como el texto de sus párrafos (sin la etiqueta "Comentario:" de la página); un comentario escrito sin párrafos viene con la etiqueta, tal como se muestra.

Cada entrada de la pregunta es un campo con su nombre en el formulario, como `q9:1_answer` (`q<usage>:<slot>_<name>`). Responder es dar valores para esos nombres:

- `choice`: botones de radio (opción única, verdadero/falso); da uno de los `options[].value`. Una pregunta de opción única tiene además una opción "borrar mi elección" con el valor `-1`.
- `checkbox`: una por cada opción de una pregunta de respuesta múltiple; da `"1"` para marcarla y `"0"` para desmarcarla. Su `label` es el texto de la opción.
- `select`: un desplegable (las filas de las preguntas de emparejamiento, etiquetadas con el texto de la fila); da uno de los `options[].value`.
- `text`: una respuesta escrita (respuesta corta, numérica, ensayo); da el texto.

`value` es la respuesta actual, para que un programa pueda ver lo que ya está guardado.

## readAttempt

Todas las preguntas de un intento en curso, recorriendo todas sus páginas, cada una con la página en la que está.

```ts
function readAttempt(context: BrowserContext, siteUrl: string, attemptId: number): Promise<Question[]>;
```

Lanza `QuizError` cuando el intento no está abierto: está terminado (lee su revisión en su lugar) o no es de la persona.

## answerQuizQuestions

Guarda respuestas en un intento en curso sin terminarlo, y da sus preguntas después.

```ts
function answerQuizQuestions(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  answers: { slot: number; responses: Record<string, string> }[],
  options?: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void },
): Promise<{ changed: string; attemptId: number; questions: Question[] }>;
```

- `answers`: por slot, los valores por nombre de campo (consulta [Las preguntas y sus campos](#questions-and-their-fields)).
- `trail` (por defecto `"realistic"`): con `"realistic"`, en cada página el driver espera primero el tiempo que necesita una persona para leer las preguntas y las opciones de esa página (unas 240 palabras por minuto, entre 3 y 90 segundos por página), y luego guarda; con `"fast"` guarda en el acto. Consulta [El ritmo de un estudiante](../concepts/student-pace.md).
- `onProgress`: se llama cada pocos segundos durante la espera, con los segundos transcurridos y el total de la página, para que un programa pueda decirle a quien lo llama que sigue trabajando.

Las respuestas se agrupan por la página en la que está su slot, y cada página se rellena y se guarda en orden con su botón "Siguiente página", como avanza una persona por el intento; las páginas sin respuestas no se visitan. Moodle conserva todo lo guardado, así que las respuestas se pueden dar en varias llamadas y cambiar después mientras el intento esté abierto.

Errores: `QuizError` cuando el intento no está abierto, o cuando un slot no está en él (se comprueba antes de guardar nada); `FormError` cuando una página no tiene ningún campo con un nombre indicado, en cuyo caso esa página y las siguientes no se guardan (las anteriores ya lo están).

## finishQuizAttempt

Envía el intento para calificarlo, como hace "Enviar todo y terminar" (sin su diálogo de confirmación), y da su revisión cuando el cuestionario muestra una.

```ts
function finishQuizAttempt(context: BrowserContext, siteUrl: string, attemptId: number): Promise<{
  changed: string;
  attemptId: number;
  finished: true;
  review?: { summary: Detail[]; questions: Question[] };
}>;
```

`review` falta cuando las opciones de revisión del cuestionario no la muestran justo después del intento. Lanza `QuizError` cuando el intento no se puede terminar: ya está terminado, o no es de la persona. Las preguntas sin responder se envían tal como están, como hace Moodle.

## readReview

La revisión de un intento terminado, hasta donde las opciones de revisión del cuestionario dejan verla a la persona: la tabla de resumen (estado, fechas, puntuaciones, calificación) y las preguntas con su estado, puntuación, retroalimentación y respuesta correcta.

```ts
function readReview(context: BrowserContext, siteUrl: string, attemptId: number): Promise<{ summary: Detail[]; questions: Question[] }>;
```

Un profesor también puede leer así el intento de un estudiante. Lanza `QuizError` cuando la revisión no está disponible: el intento no está terminado, no es de la persona (para un estudiante), o el cuestionario todavía no muestra revisiones.

## El intento de un estudiante de principio a fin {#a-students-attempt-from-start-to-finish}

```ts
import { QuizError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const quizId = 26;

const info = await moodle.quizInfo(quizId);
if (!info.canStart) throw new Error(`No se puede hacer un intento: ${info.messages.join(" ")}`);

const { attemptId, questions } = await moodle.startQuizAttempt(quizId);

// Elige una respuesta para cada pregunta: aquí, la primera opción de cada campo choice y select,
// saltándose "borrar mi elección" (-1) y el "Elegir..." de un desplegable (0); el "0" de un radio verdadero/falso es "Falso", una respuesta real.
const answers = questions.map((question) => {
  const responses: Record<string, string> = {};
  for (const field of question.fields) {
    if ((field.kind === "choice" || field.kind === "select") && field.options) {
      const option = field.options.find((o) => o.value !== "-1" && !(field.kind === "select" && o.value === "0")) ?? field.options[0];
      if (option) responses[field.name] = option.value;
    }
  }
  return { slot: question.slot, responses };
});

try {
  const answered = await moodle.answerQuizQuestions(attemptId, answers, {
    onProgress: (elapsed, total) => console.log(`Leyendo... ${elapsed}/${total} s`),
  });
  console.log(answered.questions.map((q) => `${q.number}: ${q.state}`).join(", "));

  const done = await moodle.finishQuizAttempt(attemptId);
  for (const row of done.review?.summary ?? []) console.log(`${row.label}: ${row.value}`);
} catch (error) {
  if (error instanceof QuizError) console.error(error.message);
  else throw error;
}
```

## quizResults

Los intentos de un cuestionario tal como los muestra a un profesor su informe de resultados (la vista general): por intento, el usuario, el estado, las fechas, la calificación y la puntuación de cada pregunta; con `responses`, también la respuesta a cada pregunta del informe de respuestas. Se leen todas las páginas del informe.

```ts
function quizResults(context: BrowserContext, siteUrl: string, activityId: number, options?: { responses?: boolean; limit?: number; offset?: number }): Promise<{
  quiz: { id: number };
  attempts: QuizAttemptResult[]; // ListPage<QuizAttemptResult> con limit
}>;

interface QuizAttemptResult {
  id: number;
  userId: number;
  fullName: string;
  state?: string;
  started?: string;
  completed?: string;
  duration?: string;
  grade?: string;
  questions: { slot: number; mark?: string; response?: string; result?: string }[];
}
```

- `responses` (por defecto `false`): lee también el informe de respuestas y añade la `response` de cada pregunta, lo que cuesta una segunda pasada por el informe.
- `limit`, `offset`: `attempts` como una página en el orden del informe (consulta [Listas largas](../concepts/calling-functions.md#long-lists)), leída de la única página de la paginación propia del informe (`pagesize`, que no se guarda como preferencia de la persona) que la contiene; con `responses`, la misma página del informe de respuestas (todas sus páginas si la persona ordenó los dos informes de forma distinta).
- `state`, `started`, `completed`, `duration` y `grade` vienen tal como los muestra el informe, en el idioma del sitio ("Finalizado", "9 oct 13:30", "50 segundos", "5,00"); una calificación ausente ("-") se omite.
- `questions[].mark`: la puntuación tal como se muestra ("-" se omite); `result`: cómo se puntuó ("correct", "incorrect", "partiallycorrect", "notanswered", "requiresgrading"...).

Las personas vienen como id de usuario y nombre completo: ocultar quiénes son es tarea del programa que llama. El informe lista los intentos de los usuarios matriculados. Lanza `QuizError` con el mensaje de Moodle cuando la persona no puede ver el informe (un estudiante, o el id no es un cuestionario).

## questionsToGrade

Las preguntas de un cuestionario que esperan calificación manual, tal como las lista su informe de calificación manual, cada una con los intentos terminados cuya respuesta requiere calificación.

```ts
function questionsToGrade(context: BrowserContext, siteUrl: string, activityId: number): Promise<{
  quiz: { id: number };
  questions: QuestionToGrade[];
}>;

interface QuestionToGrade {
  slot: number;
  questionId?: number;
  name: string;
  type: string;
  toGrade: number;
  graded: number;
  total: number;
  attempts: { id: number; userId: number; fullName: string }[];
}
```

- `slot`, `questionId`, `name`, `type`: la pregunta, como en el cuestionario (`type` es "essay" en la mayoría).
- `toGrade`, `graded`, `total`: los recuentos del informe: intentos que esperan calificación, ya calificados a mano, y en total.
- `attempts`: los intentos que esperan, con el id del intento (lo que reciben `gradeQuizQuestion` y `readReview`) y su persona; salen del informe de resultados (el resultado `requiresgrading` de la pregunta en [`quizResults`](#quizresults)), ya que el propio informe de calificación solo nombra los intentos por persona.

El informe de Moodle lista las preguntas que necesitan calificación manual, no las calificadas automáticamente. Lanza `QuizError` con el mensaje de Moodle cuando la persona no puede calificar el cuestionario.

## gradeQuizQuestion

Califica a mano una pregunta de un intento terminado, con un comentario, mediante el formulario de comentario de Moodle ("Escribir comentario o corregir la puntuación" de la revisión): un ensayo que espera su calificación, o cualquier pregunta cuya puntuación sobrescribe el profesor.

```ts
function gradeQuizQuestion(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  slot: number,
  options: { mark: number; comment?: string },
): Promise<{ changed: string; attemptId: number; slot: number; mark: number; maxMark?: number; grade?: string }>;
```

- `mark`: en los puntos de la pregunta en el cuestionario, de 0 a su máximo (`maxMark` en el resultado).
- `comment` (HTML): el comentario del profesor que el estudiante ve en la revisión; sin él, se queda el comentario que ya tenga la pregunta.
- `grade`: la calificación del intento después, tal como la muestra el informe de resultados ("9,17"); Moodle también actualiza la calificación del cuestionario en el libro de calificaciones.

Ningún servicio AJAX califica una pregunta, así que esto rellena el formulario de comentario y lo envía como hace su botón Guardar. Errores: `FormError` con el mensaje de Moodle en el campo `mark` cuando la puntuación está fuera del rango de la pregunta o no es un número que Moodle entienda; `QuizError` cuando no se puede abrir el formulario (el intento no está terminado, el slot no está en él, o la persona no puede calificar; el motivo de Moodle viene en el mensaje), o cuando la pregunta no tiene puntuación (una descripción).

```ts
// Califica todos los ensayos pendientes del cuestionario 47 con la mitad de su puntuación, y un comentario.
const { questions } = await moodle.questionsToGrade(47);
for (const question of questions) {
  for (const attempt of question.attempts) {
    const result = await moodle.gradeQuizQuestion(attempt.id, question.slot, { mark: 2.5, comment: "<p>Visto; lo hablamos en clase.</p>" });
    console.log(result.changed);
  }
}
```

## quizStructure

Las preguntas de un cuestionario tal como las lista su página de edición: los slots en orden, cada uno con su página, pregunta, tipo, nombre y puntuación, y las secciones del cuestionario.

```ts
function quizStructure(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;

interface QuizSlot {
  id: number;
  slot: number;
  number?: number;
  page: number;
  questionId?: number;
  type: string;
  name: string;
  mark?: string;
}

interface QuizSection {
  id: number;
  heading: string;
  firstSlot: number;
  shuffle: boolean;
}
```

- `id`: el id de Moodle del slot; `slot`: su lugar en el cuestionario, desde 1, que es lo que reciben las funciones que cambian un slot; `number`: el número de la pregunta tal como se muestra (las descripciones no tienen).
- `page`: la página en la que está, tal como las numera la página de edición (desde 1).
- `questionId`: el id de la pregunta del banco; falta en una pregunta aleatoria.
- `type`: el tipo de pregunta, o `"random"` para una pregunta aleatoria sacada de una categoría.
- `mark`: la puntuación máxima del slot tal como se muestra ("1,00").
- `sections`: todo cuestionario tiene al menos una, que empieza en el slot 1; `heading` está vacío en una sin título, y `shuffle` dice si sus preguntas salen en orden aleatorio en cada intento.

Necesita permiso para editar el cuestionario; si no, lanza `QuizError` con el motivo de Moodle.

## addQuestionsToQuiz

Añade preguntas de un banco por id, y preguntas aleatorias de una categoría de un banco, tal como las envían las acciones "del banco de preguntas" y "una pregunta aleatoria" de la página de edición. Devuelve la estructura del cuestionario después.

```ts
function addQuestionsToQuiz(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: {
    questionIds?: number[];
    random?: { categoryId: number; count: number; includeSubcategories?: boolean };
    page?: number;
  },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

- `questionIds` (por defecto ninguno): ids de preguntas del banco, de [`questions`](question-banks.md).
- `random`: `count` preguntas aleatorias sacadas de la categoría `categoryId` (de las categorías del banco), con sus subcategorías cuando `includeSubcategories` es true (por defecto false).
- `page` (por defecto `0`): la página a la que añadirlas; `0` las añade al final, como hace Moodle.

Moodle no deja cambiar las preguntas de un cuestionario que ya tiene intentos: la página de edición no ofrece entonces menú de añadir, y esto lanza `QuizError` antes de enviar nada (crea un cuestionario nuevo, o borra sus intentos en Moodle). También lanza `QuizError` cuando no se indican ni preguntas ni una categoría, cuando Moodle responde al envío con un error, y cuando no se añadió ninguna pregunta (ids o categoría incorrectos).

## Cambiar la estructura de un cuestionario {#changing-a-quizs-structure}

Estas funciones cambian un cuestionario como lo hace su página de edición, y devuelven su estructura después: `{ changed, quiz, slots, sections }`. Los slots se indican por su lugar (`QuizSlot.slot`, desde 1), tal como los lista `quizStructure`; los lugares cambian después de quitar o mover un slot, así que vuelve a leerlos del resultado. Moodle no deja que un cuestionario con intentos cambie sus preguntas, su orden ni sus páginas: estas funciones lanzan `QuizError` con el aviso de Moodle antes de cambiar nada (crea un cuestionario nuevo, o borra sus intentos en Moodle). Los propios rechazos de Moodle (quitar el único slot de una sección, una página fuera de rango en un movimiento) llegan como `QuizError` con su mensaje.

### editQuizSlot

Cambia la puntuación máxima de un slot, y lo mueve: después de otro slot y a una página, como hace arrastrarlo.

```ts
function editQuizSlot(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  slot: number,
  changes: { maxMark?: number; moveAfter?: number; page?: number },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

- `maxMark`: los puntos que vale la pregunta en este cuestionario, mediante el servicio `mod_quiz_update_slots` de Moodle. Moodle lo permite también después de que haya intentos, y los recalifica (y el libro de calificaciones).
- `moveAfter`: el slot tras el que ponerlo, `0` para ponerlo el primero.
- `page`: la página en la que ponerlo; por defecto, la página del slot tras el que va (la página 1 cuando es el primero). Moodle acepta una página desde la de ese slot hasta la del siguiente.

### removeQuizSlot

Quita un slot de un cuestionario, como hace su icono de borrar; la pregunta se queda en su banco.

```ts
function removeQuizSlot(context: BrowserContext, siteUrl: string, activityId: number, slot: number): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

### setQuizPages

Repagina un cuestionario, o pone sus saltos de página exactamente después de los slots indicados.

```ts
function setQuizPages(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  pages: { perPage: number } | { breaksAfter: number[] },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

- `perPage`: preguntas por página, `0` para todas en una página, como hace "Repaginar" en la página de edición. Aun así, cada sección empieza en una página propia.
- `breaksAfter`: los slots tras los que termina una página, y ningún otro; cada salto añadido o quitado es una de las peticiones de salto de página de la página de edición.

### addQuizSection

Añade una sección que empieza en un slot, con su encabezado, y si sus preguntas se barajan.

```ts
function addQuizSection(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  section: { firstSlot: number; heading: string; shuffle?: boolean },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[]; sectionId: number }>;
```

Una sección empieza en una página, como en Moodle: `firstSlot` debe ser el primer slot de su página (añade primero un salto de página antes de él con `setQuizPages`), y el cuestionario no puede tener ya una sección ahí. `shuffle` es false por defecto.

```ts
// Cuestionario 49, aún sin intentos: quita el slot 4, pon el slot 3 el primero valiendo 2 puntos, dos páginas y una segunda parte.
await moodle.removeQuizSlot(49, 4);
await moodle.editQuizSlot(49, 3, { moveAfter: 0, maxMark: 2 });
await moodle.setQuizPages(49, { breaksAfter: [2] });
const { slots, sections } = await moodle.addQuizSection(49, { firstSlot: 3, heading: "Parte B", shuffle: true });
console.log(slots.map((s) => `${s.slot}. ${s.name} (página ${s.page}, ${s.mark})`), sections);
```

## setQuizOverride

Pone una excepción de usuario en un cuestionario mediante su formulario de excepciones: otras fechas de apertura y cierre, un límite de tiempo o un número de intentos para un estudiante. Lo que no se indica se queda como en el cuestionario.

```ts
function setQuizOverride(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  options: { open?: Date; close?: Date; timeLimitMinutes?: number; attempts?: number },
): Promise<{ changed: string }>;
```

- `open`, `close`: fechas, que se rellenan en la zona horaria de la persona en Moodle, como lee Moodle sus selectores de fecha.
- `timeLimitMinutes`: el límite de tiempo en minutos.
- `attempts`: los intentos permitidos, `0` para ilimitados.

El formulario solo ofrece usuarios que pueden recibir una excepción: un usuario que no es participante, o que ya tiene una excepción en este cuestionario, recibe un `QuizError` (cambia una excepción existente en Moodle). `QuizError` también llega cuando no se puede abrir el formulario (no es un cuestionario, o no está permitido). `FormError` llega cuando Moodle rechaza los valores (una fecha de cierre anterior a la de apertura) o cuando la zona horaria de la persona no es una que conozca el driver.

```ts

// Quién hizo qué, con sus respuestas.
const { attempts } = await moodle.quizResults(27, { responses: true });
for (const attempt of attempts) {
  console.log(`${attempt.fullName}: ${attempt.grade ?? "sin calificar"}`);
  for (const q of attempt.questions) console.log(`  P${q.slot} ${q.result ?? ""} ${q.response ?? ""}`);
}

// Una semana más y un intento extra para el usuario 7.
await moodle.setQuizOverride(27, 7, { close: new Date("2026-11-30T18:00:00Z"), attempts: 3 });

// Dos preguntas del banco y tres aleatorias, en un cuestionario que nadie ha intentado todavía.
const { changed, slots } = await moodle.addQuestionsToQuiz(41, { questionIds: [22, 23], random: { categoryId: 14, count: 3 } });
console.log(changed, slots.length);
```

## Piezas de más bajo nivel {#lower-level-pieces}

Los pasos sueltos sobre los que se construyen estas funciones (empezar un intento, guardar una página, terminar) y los lectores de páginas no se exportan: cambian con las páginas de Moodle. Un programa que necesite otra cosa pasa por `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

## Categorías de datos {#data-categories}

- `quizInfo`: `course-content` y `own` (el cuestionario y los intentos de la persona).
- `startQuizAttempt`, `readAttempt`, `answerQuizQuestions`, `finishQuizAttempt`: `own`.
- `readReview`: `own` y `others-personal`, ya que un profesor puede revisar el intento de otra persona.
- `quizResults`, `questionsToGrade`: `others-personal`.
- `gradeQuizQuestion`: `others-personal` y `others-write`.
- `quizStructure`, `addQuestionsToQuiz`, `removeQuizSlot`, `setQuizPages`, `addQuizSection`: `course-content`.
- `editQuizSlot`: `course-content` y `others-write` (una nueva puntuación máxima recalifica los intentos ya hechos).
- `setQuizOverride`: `others-write`.

Consulta [Categorías de datos](../concepts/data-categories.md).

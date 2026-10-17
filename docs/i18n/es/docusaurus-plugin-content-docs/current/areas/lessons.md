# Lecciones

Recorrer una actividad de lección página a página, como lo hace un estudiante: leer la página en la que está la persona (contenido con sus botones, o una pregunta con su formulario), responderla y recibir la retroalimentación de Moodle y la página que sigue, hasta el final de la lección. Moodle guarda dónde está la persona, así que un programa lee y responde una página cada vez solo con el id del módulo del curso de la lección, entre llamadas y ejecuciones. Como profesor de la lección, un programa también construye sus páginas como lo hace el editor de lecciones de Moodle: páginas de contenido con botones, páginas de pregunta con respuestas, puntuaciones y saltos, y las páginas estructurales, leídas de vuelta, movidas y borradas. Los informes de las lecciones no se cubren.

**Términos:** [página de lección](../reference/glossary.md#lesson-page), [rastro](../reference/glossary.md#trail).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Las páginas se leen de los formularios y bloques de la lección (acciones de formulario, nombres de entrada, clases), así que funciona en cualquier idioma de la interfaz; los textos llegan en el idioma del sitio. Todas las funciones lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)), y `LessonError` cuando el id no es una lección que la persona pueda abrir (o editar, en las funciones del profesor).

## La página de lección {#the-lesson-page}

Las dos funciones dan las páginas como objetos `LessonPage`:

```ts
interface LessonPage {
  kind: "content" | "question" | "feedback" | "end";
  pageId?: number;
  title?: string;
  text: string;
  buttons?: { label: string; jumpTo: number }[];
  fields?: LessonField[];
  feedback?: { correct?: boolean; response?: string };
}

interface LessonField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
}
```

- `kind`: una página de contenido (`content`, texto y botones), una página de pregunta (`question`, un formulario que responder), la retroalimentación (`feedback`) que muestra Moodle tras una respuesta, o el final (`end`) de la lección.
- `pageId`: el id de la página; para la retroalimentación, la página a la que lleva su "Continuar".
- `title`: el encabezado de la página, cuando tiene uno.
- `text`: la página tal como se muestra: su contenido, la pregunta, los mensajes de Moodle o, al final, la puntuación ("Your score is 1 (out of 1)").
- `buttons`: los botones de una página de contenido, cada uno con su etiqueta y la página a la que salta, con los códigos de salto de Moodle: un id de página, o `-1` para la página siguiente, `-9` para el final de la lección y otros códigos negativos para los demás saltos de Moodle.
- `fields`: las entradas de una página de pregunta por nombre en el formulario: `choice` (botones de opción, da uno de los `options[].value`), `checkbox` (da `"1"` para marcarla), `select` (da el valor de una opción), `text` (respuesta escrita). Las preguntas de emparejamiento son desplegables; las de ensayo y respuesta corta son texto.
- `feedback`: en una página de retroalimentación, si Moodle dio la respuesta por buena (`correct`, ausente cuando la página no lo dice) y la respuesta del profesor a esa respuesta.

## lessonPage

La página en la que está la persona, sin responder nada.

```ts
function lessonPage(context: BrowserContext, siteUrl: string, activityId: number): Promise<LessonPage>;
```

La primera vez, abre la primera página de la lección, lo que inicia el intento de la persona como lo hace abrirla en Moodle. Cuando la persona ya ha recorrido la lección antes, Moodle pregunta si seguir desde la última página que vio: el driver acepta, así que lee donde estaba la persona. Una lección que ha terminado para la persona muestra su página final (`kind: "end"`). Una página que no es ni de contenido, ni de pregunta, ni de retroalimentación llega como `end` con el texto de Moodle (una lección aún no abierta, por ejemplo): comprueba `text` antes de tomar `end` como el final real de la lección.

## answerLessonPage

Responde la página en la que está la persona y devuelve lo que hizo (`changed`), la retroalimentación de Moodle cuando la da y la página que sigue.

```ts
function answerLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  answer: { button?: string | number; responses?: Record<string, string> },
  options?: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void },
): Promise<{ changed: string; feedback?: LessonPage; page: LessonPage }>;
```

- `answer.button`: en una página de contenido, el botón que pulsar, por su etiqueta (exactamente como en `buttons[].label`) o por su posición (desde 0).
- `answer.responses`: en una página de pregunta, los valores por nombre de campo.
- `trail` (por defecto `"realistic"`): con `"realistic"` el driver espera primero el tiempo que una persona necesita para leer la página (su texto, etiquetas y opciones, unas 240 palabras por minuto, entre 3 y 90 segundos); `"fast"` responde enseguida. Consulta [Ritmo de estudiante](../concepts/student-pace.md).
- `onProgress`: se llama cada pocos segundos mientras espera, con los segundos transcurridos y el total.

Lo que vuelve:

- `feedback`: cuando Moodle muestra una página de retroalimentación tras la respuesta (la respuesta correcta o incorrecta de una pregunta, su "Continuar"), esa página; su `pageId` dice adónde sigue (la misma pregunta para volver a intentarlo, la página siguiente, `-9` para el final). El driver pulsa entonces "Continuar" como lo haría la persona.
- `page`: la página en la que está la persona después, que responde la siguiente llamada. Llegar al final (`kind: "end"`) termina el intento.

`LessonError` llega cuando el botón no es uno de los de la página de contenido (el error los enumera con sus posiciones), cuando una página de pregunta no recibe respuestas y cuando la página no se puede responder: la lección ha terminado, o la página solo sigue adelante. `FormError` llega cuando el formulario de una pregunta no tiene un campo con un nombre dado. La página se lee y se hace la pausa de lectura antes de estas comprobaciones.

Moodle decide qué sigue a cada respuesta según los ajustes de la lección: una respuesta incorrecta puede llevar de vuelta a la misma pregunta, a otra página o adelante; una lección puede permitir repetirla o no. El driver sigue lo que hace Moodle y lo informa.

## Ejemplo {#example}

```ts
import { LessonError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.
const lessonId = 39;

let page = await moodle.lessonPage(lessonId);
try {
  // A lo largo de la lección: el primer botón en las páginas de contenido, la primera opción en las preguntas.
  for (let step = 0; step < 50 && page.kind !== "end"; step++) {
    console.log(`[${page.kind}] ${page.title ?? ""} ${page.text}`);
    let answer: { button?: number; responses?: Record<string, string> };
    if (page.kind === "content") {
      answer = { button: 0 };
    } else {
      const responses: Record<string, string> = {};
      for (const field of page.fields ?? []) responses[field.name] = field.options?.[0]?.value ?? "bucle";
      answer = { responses };
    }
    const result = await moodle.answerLessonPage(lessonId, answer, {
      onProgress: (elapsed, total) => console.log(`  leyendo ${elapsed}/${total} s`),
    });
    if (result.feedback) console.log(`  ${result.feedback.feedback?.correct ? "correcta" : "incorrecta"}: ${result.feedback.feedback?.response ?? ""}`);
    page = result.page;
  }
  console.log(page.text);
} catch (error) {
  if (error instanceof LessonError) console.error(error.message);
  else throw error;
}
```

## Construir las páginas de una lección {#building-a-lessons-pages}

Una lección se crea como cualquier actividad (`createActivity` con `type: "lesson"`, consulta [Actividades y secciones](activities.md)); sus páginas se añaden aquí, como las añade su profesor en el editor de lecciones de Moodle ("Editar" en la lección). Estas funciones requieren un rol de profesor en el curso (la capacidad `mod/lesson:edit` de Moodle). Los servicios de lecciones de Moodle no están abiertos a las llamadas AJAX que hace el driver, así que trabaja con las páginas del editor: la vista del editor para el orden, los títulos y los contenidos de las páginas, el formulario de cada página para su tipo, respuestas, puntuaciones y saltos, y los enlaces de mover y borrar del editor.

```ts
type LessonPageType = "content" | "multichoice" | "truefalse" | "shortanswer" | "numerical" | "matching" | "essay" | "cluster" | "end-of-cluster" | "end-of-branch";
type LessonJump = number | "this-page" | "next-page" | "previous-page" | "end-of-lesson" | "unseen-in-branch" | "random-in-branch" | "random-branch" | "unseen-in-cluster";

interface LessonPageDefinition {
  id: number;
  type: LessonPageType;
  title: string;
  contents: string;
  buttons?: { label: string; jumpTo: LessonJump }[];
  answers?: LessonAnswer[];
  multipleAnswers?: boolean;
  caseSensitive?: boolean;
}

interface LessonAnswer {
  text?: string;
  response?: string;
  score?: number;
  jumpTo?: LessonJump;
  others?: boolean;
}
```

- `type`: una página de contenido (`content`, la página de contenido de Moodle, antes llamada tabla de ramificación: texto y botones), una página de uno de los tipos de pregunta de las lecciones de Moodle, o una página estructural: un grupo (`cluster`) y su fin (`end-of-cluster`), entre los que Moodle elige preguntas al azar, o un fin de ramificación (`end-of-branch`), donde la rama de una página de contenido vuelve a ella. `LESSON_PAGE_TYPES` los enumera.
- `contents`: el HTML de la página, tal como lo muestra la vista expandida del editor.
- `buttons`: los botones de una página de contenido, en orden, cada uno con su etiqueta y adónde lleva.
- `answers`: las respuestas de una página de pregunta, en orden. Las respuestas de opción múltiple, verdadero/falso y emparejamiento son HTML (el editor de Moodle envuelve un texto plano en `<p>`); las de respuesta corta y numéricas son texto plano (una respuesta numérica puede ser un intervalo, `"1:5"`). Cada una tiene la `response` que se muestra tras ella, su puntuación (`score`, con la puntuación personalizada de la lección) y su salto (`jumpTo`). Una página de verdadero/falso tiene dos, primero la verdadera. Las dos primeras filas de una página de emparejamiento son las respuestas a un emparejamiento correcto y a uno incorrecto (su `text`, con su salto y su puntuación); detrás van sus parejas, cada `text` el elemento y `response` la respuesta que le corresponde. La fila de una página de respuesta corta o numérica para cualquier otra respuesta va la última, con `others: true` y sin `text`, cuando está activado "Todas las demás respuestas" de Moodle. Un ensayo, un grupo, un fin de grupo o un fin de ramificación tiene una sola fila: su salto (y la puntuación de un ensayo).
- `jumpTo`: una página de la lección por su id, o uno de los saltos de Moodle por su nombre. `LESSON_JUMPS` da sus códigos: `"this-page"` 0, `"next-page"` -1, `"previous-page"` -40, `"end-of-lesson"` -9, `"unseen-in-branch"` -50, `"random-in-branch"` -60, `"random-branch"` -70, `"unseen-in-cluster"` -80. Moodle ofrece los saltos de ramificación en las páginas de contenido y en las páginas de sus ramas, y el salto de grupo dentro de un grupo.
- `multipleAnswers`: una página de opción múltiple cuya pregunta tiene más de una respuesta correcta. `caseSensitive`: el "Sensible a mayúsculas" de una página de respuesta corta.

## lessonPages

Las páginas de la lección, en orden, tal como las define su profesor.

```ts
function lessonPages(context: BrowserContext, siteUrl: string, activityId: number): Promise<LessonPageDefinition[]>;
```

Lee la vista expandida del editor y el formulario de cada página, una carga de página por página. Moodle recuerda si la persona miró el editor por última vez contraído o expandido: cuando estaba contraído, el driver abre la vista expandida para leerla y después vuelve a pedir la contraída, así que la persona encuentra el editor como lo dejó. Una lección sin páginas es `[]`. Un estudiante, o cualquiera que no pueda editar la lección, recibe `LessonError`.

## addLessonPage

Añade una página a la lección y devuelve lo que hizo (`changed`), el id de la página nueva (`pageId`) y los ids de las páginas de la lección en orden después (`pageIds`).

```ts
function addLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: LessonPageInput,
  options?: { after?: number },
): Promise<{ changed: string; pageId: number; pageIds: number[] }>;

interface LessonPageInput {
  type: LessonPageType;
  title?: string;
  contents?: string;
  embed?: string[];
  buttons?: { label: string; jumpTo?: LessonJump }[];
  answers?: LessonAnswer[];
  multipleAnswers?: boolean;
  caseSensitive?: boolean;
  fields?: Record<string, FieldValue>;
}
```

- `after`: la página tras la que va; `0` la pone la primera. Por defecto va la última.
- `title`: obligatorio, salvo en las páginas estructurales, a las que Moodle pone nombre ("Cluster", "End of branch"…).
- `contents`: el HTML de la página. Los archivos locales que nombra (`<img src="diagram.png">`) se dan en `embed` (rutas absolutas) y se suben con la página, como lo hace el botón de imagen del editor; lo mismo vale para el HTML de las respuestas.
- `buttons` (páginas de contenido) y `answers` (todos los demás tipos), como los da `lessonPages`. Un salto que no se da es el del propio formulario: la página siguiente para la primera respuesta de una pregunta, esta página para sus otras respuestas y para el primer botón de una página de contenido.
- `fields`: cualquier otro campo del formulario de la página, por nombre (`layout` y `display` de una página de contenido, por ejemplo).

Moodle crea un grupo, un fin de grupo o un fin de ramificación al momento, sin formulario (un fin de ramificación va tras las páginas de la rama de una página de contenido, y su salto es esa página de contenido); cuando se da un título, un contenido o un salto, el driver los guarda después en la página nueva. Una página puesta la primera no ofrece otras páginas a las que saltar en el formulario de Moodle: el driver la guarda y después pone esos saltos en la página guardada.

Se comprueba antes de guardar nada, como `LessonError`: el tipo; un título; un salto a una página que la lección no tiene, o un nombre de salto que no lo es; que `after` sea una página de la lección; más respuestas o botones de los que la lección admite por página (su ajuste "Número máximo de respuestas"); respuestas en una página de contenido o botones en una pregunta; una página de verdadero/falso con un número de respuestas distinto de dos; una puntuación cuando la lección no usa puntuación personalizada (Moodle pone entonces las puntuaciones por sí mismo: activa "Puntuación personalizada" en los ajustes de la lección); un salto que Moodle no ofrece en esa página (los saltos de ramificación fuera de una rama, por ejemplo). Las comprobaciones propias de Moodle llegan como `FormError` con sus mensajes por campo (una página de pregunta sin contenido, una de opción múltiple con menos de dos respuestas).

## editLessonPage

Cambia una página a través de su formulario con lo que se da, y devuelve `changed` y el id de la página. Una página conserva su tipo.

```ts
function editLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  pageId: number,
  changes: Partial<Omit<LessonPageInput, "type">>,
): Promise<{ changed: string; pageId: number }>;
```

Los `buttons` o `answers` dados sustituyen a todos: las demás filas del formulario se vacían, y Moodle descarta las vacías (la fila para otras respuestas de una página de respuesta corta o numérica se desactiva si no se vuelve a dar). Las comprobaciones son las de `addLessonPage`.

## moveLessonPage

Mueve una página tras otra (`after`, `0` para la primera), como lo hace el enlace de mover del editor, y devuelve `changed` y los ids de las páginas en orden.

```ts
function moveLessonPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, after: number): Promise<{ changed: string; pageIds: number[] }>;
```

Los saltos a páginas por id siguen apuntando a las mismas páginas; "página siguiente" y "página anterior" siguen a la página hasta sus nuevas vecinas.

## deleteLessonPage

Borra una página, como lo hace el enlace de borrar del editor una vez confirmado, y devuelve `changed` y los ids de las páginas que quedan.

```ts
function deleteLessonPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number): Promise<{ changed: string; pageIds: number[] }>;
```

Las respuestas de otras páginas que saltaban a ella se quedan como las deja Moodle: compruébalas con `lessonPages`.

## Ejemplo: una lección ramificada {#example-a-branching-lesson}

```ts
// `moodle` es el objeto de createMoodle(), con la sesión del profesor del curso.
const courseId = 12;
const [section] = await moodle.courseStructure(courseId);
const { activityId } = await moodle.createActivity({ courseId, sectionId: section!.id, type: "lesson", name: "Bucles", visibility: "shown" });
const lessonId = activityId!;

const start = await moodle.addLessonPage(lessonId, {
  type: "content",
  title: "Bucles",
  contents: "<p>Un bucle repite un bloque de código.</p>",
  buttons: [
    { label: "Responder la pregunta", jumpTo: "next-page" },
    { label: "Salir", jumpTo: "end-of-lesson" },
  ],
});
const right = await moodle.addLessonPage(lessonId, { type: "content", title: "Bien hecho", contents: "<p>Eso es.</p>", buttons: [{ label: "Terminar", jumpTo: "end-of-lesson" }] });
const wrong = await moodle.addLessonPage(lessonId, { type: "content", title: "No exactamente", contents: "<p>Vuelve a leerlo.</p>", buttons: [{ label: "Volver", jumpTo: start.pageId }] });
await moodle.addLessonPage(lessonId, { type: "end-of-branch", answers: [{ jumpTo: start.pageId }] });

// La pregunta va justo tras la primera página; cada respuesta lleva a otro sitio.
await moodle.addLessonPage(
  lessonId,
  {
    type: "multichoice",
    title: "¿Qué bucle recorre una lista?",
    contents: "<p>¿Qué bucle recorre una lista?</p>",
    answers: [
      { text: "for", response: "<p>Correcto.</p>", score: 1, jumpTo: right.pageId },
      { text: "while", response: "<p>Puede, pero no por sí solo.</p>", score: 0, jumpTo: wrong.pageId },
    ],
  },
  { after: start.pageId },
);

for (const page of await moodle.lessonPages(lessonId)) {
  const leads = (page.buttons ?? page.answers ?? []).map((row) => String(row.jumpTo)).join(", ");
  console.log(`${page.id} ${page.type} "${page.title}" -> ${leads}`);
}
```

## Categorías de datos {#data-categories}

- `lessonPage`: `course-content` y `own` (la lección y dónde está la persona en ella).
- `answerLessonPage`: `own`.
- `lessonPages`, `addLessonPage`, `editLessonPage`, `moveLessonPage`, `deleteLessonPage`: `course-content`.

Consulta [Categorías de datos](../concepts/data-categories.md).

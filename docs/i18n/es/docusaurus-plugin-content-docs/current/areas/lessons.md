# Lecciones

Recorrer una actividad de lección página a página, como lo hace un estudiante: leer la página en la que está la persona (contenido con sus botones, o una pregunta con su formulario), responderla y recibir la retroalimentación de Moodle y la página que sigue, hasta el final de la lección. Moodle guarda dónde está la persona, así que un programa lee y responde una página cada vez solo con el id de módulo del curso de la lección, entre llamadas y ejecuciones. La edición de lecciones por los profesores y sus informes no se cubren.

**Términos:** [página de lección](../reference/glossary.md#lesson-page), [rastro](../reference/glossary.md#trail).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Las páginas se leen de los formularios y bloques de la lección (acciones de formulario, nombres de entrada, clases), así que funciona en cualquier idioma de la interfaz; los textos llegan en el idioma del sitio. Todas las funciones lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)), y `LessonError` cuando el id no es una lección que la persona pueda abrir.

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

## Categorías de datos {#data-categories}

- `lessonPage`: `course-content` y `own` (la lección y dónde está la persona en ella).
- `answerLessonPage`: `own`.

Consulta [Categorías de datos](../concepts/data-categories.md).

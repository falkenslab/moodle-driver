# Encuestas y consultas

Responder encuestas y consultas como lo hace un estudiante: leer las preguntas de una encuesta con sus campos y rellenarla página a página, y leer las opciones de una consulta y elegir una o varias. Se admiten dos módulos de encuesta: el módulo Retroalimentación de Moodle (`feedback`) y el plugin Cuestionario (`questionnaire`, mod_questionnaire). El módulo "survey" más antiguo de Moodle (instrumentos fijos como COLLES y ATTLS) no. Estas funciones actúan como la persona, sobre sus propias respuestas; las vistas de las respuestas para los profesores no se cubren.

**Términos:** [encuesta](../reference/glossary.md#survey), [consulta](../reference/glossary.md#choice), [retroalimentación](../reference/glossary.md#feedback).

Las firmas de abajo son las de las funciones. Cada operación es también un método del [objeto Moodle](../concepts/calling-functions.md) sin sus dos primeros parámetros (`fn(context, site, …)` es `moodle.fn(…)`), que es como las llaman los ejemplos; las primitivas de más bajo nivel están en `@falkenslab/moodle-driver/internals` (consulta [Bajar de nivel](../concepts/low-level.md)).

Todo se lee de las páginas y los formularios de las actividades (ids del body, nombres de formulario, etiquetas), así que funciona en cualquier idioma de la interfaz; los textos llegan en el idioma del sitio. Todas las funciones lanzan `NotLoggedInError` cuando no hay sesión (consulta [Errores](../concepts/errors.md)).

## getSurvey

Si la persona puede responder ahora una encuesta, su descripción y sus mensajes y, cuando puede, todas las preguntas de todas las páginas de su formulario.

```ts
function getSurvey(context: BrowserContext, siteUrl: string, activityId: number, type?: SurveyType): Promise<{
  canAnswer: boolean;
  intro: string;
  messages: string[];
  questions: SurveyQuestion[];
}>;

type SurveyType = "questionnaire" | "feedback";

interface SurveyQuestion {
  page: number;
  number?: string;
  text: string;
  required: boolean;
  fields: SurveyField[];
}

interface SurveyField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
  value?: string;
}
```

- `activityId`: el id de la actividad (id de módulo del curso). `type`: su módulo, de la estructura del curso; sin él, el driver lo averigua por la página con la que responde cada módulo (una vez por actividad), a costa de una o dos páginas.
- `canAnswer`: la página de la actividad enlaza a su formulario: está abierta y la persona aún no ha respondido (o puede volver a responder).
- `intro`: la descripción de la actividad; `messages`: los avisos de la página ("You have already submitted", cerrada, aún no abierta).
- `questions`: vacío cuando la persona no puede responder. Cada pregunta tiene la `page` en la que está (desde 0), su `number` y su `text` tal como se muestran, si es `required`, y sus `fields`.

Un campo es una entrada del formulario, por su nombre en el formulario: ese nombre es lo que recibe `submitSurvey`.

- `choice`: botones de opción; da uno de los `options[].value`. En la cuadrícula de valoración de un cuestionario cada fila es su propio campo, etiquetado con el elemento de la fila; su opción "sin respuesta" (valor `-999`) se etiqueta `(no answer)`.
- `checkbox`: una por opción; da `"1"` para marcarla. `label` es el texto de la opción.
- `select`: un desplegable; da uno de los `options[].value`.
- `text`: texto escrito (una respuesta corta o larga, un número).

`value` es el valor actual, cuando lo hay. El formulario se lee página a página (las páginas de la retroalimentación mediante `gopage`, las secciones del cuestionario mediante `sec`), hasta 50 páginas. Lanza `SurveyError` cuando el id no es una actividad de ese módulo que la persona pueda abrir.

## submitSurvey

Rellena la encuesta página a página con las respuestas dadas y la envía en la última página, como lo haría la persona con sus botones "Página siguiente" y de envío.

```ts
function submitSurvey(context: BrowserContext, siteUrl: string, activityId: number, responses: Record<string, string>, options?: { type?: SurveyType }): Promise<{ changed: string; messages: string[] }>;
// Como antes de la 0.2, aún admitida:
function submitSurvey(context: BrowserContext, siteUrl: string, activityId: number, type: SurveyType, responses: Record<string, string>): Promise<{ changed: string; messages: string[] }>;
```

- `responses`: valores por nombre de campo, de cualquier página: cada página recibe los que tiene su formulario.
- Devuelve `changed` y los mensajes de la página de la actividad después (normalmente, que la persona ha enviado sus respuestas).

Sin `type`, el módulo se averigua como lo averigua `getSurvey`. Cada nombre se comprueba contra el formulario entero antes de enviar nada, así que un nombre erróneo no envía nada: `SurveyError` nombra los campos desconocidos. `SurveyError` también llega cuando la persona no puede responder ahora (con los mensajes de la página), cuando Moodle devuelve una página porque falta algo o algo está mal (una pregunta obligatoria sin responder: los mensajes de Moodle están en el error, por campo cuando da uno) y cuando el sitio responde con un error de servidor (5xx), en cuyo caso Moodle puede haber registrado o no las respuestas: vuelve a leer la encuesta antes de intentarlo de nuevo. `submitSurvey` no admite la opción `trail`: el formulario se rellena y se envía de una vez, página tras página.

## getChoice

Una actividad de consulta, leída en su página: sus opciones con los ids que reciben las respuestas, si se puede responder o cambiar, y la respuesta de la persona. Los servicios de las consultas de Moodle no están abiertos a llamadas AJAX, así que la fuente es la página.

```ts
function getChoice(context: BrowserContext, siteUrl: string, activityId: number): Promise<Choice>;

interface Choice {
  id: number;
  name: string;
  intro: string;
  options: { id: number; text: string; selected: boolean; full: boolean }[];
  multiple: boolean;
  canAnswer: boolean;
  canChange: boolean;
  answer: string[];
  messages: string[];
}
```

- `id`: el id de módulo del curso dado; `name` e `intro`: el nombre y la descripción de la actividad.
- `options`: el id de cada opción (lo que recibe `answerChoice`), su texto, si la persona la eligió y si está `full` (se alcanzó un límite de respuestas, así que no se puede elegir).
- `multiple`: la consulta permite varias opciones a la vez.
- `canAnswer`: el formulario está: la consulta está abierta y la persona puede responder, o cambiar su respuesta.
- `canChange`: una respuesta dada se puede quitar o cambiar.
- `answer`: las opciones elegidas, por su texto, también cuando el formulario ya no está (una consulta cerrada sigue mostrando la selección de la persona).
- `messages`: los avisos de la página (cerrada, aún no abierta, resultados no publicados...).

Lanza `ChoiceError` cuando el id no es una consulta que la persona pueda abrir.

## answerChoice

Responde una consulta con una opción, o con varias donde lo permite, por id, como hace "Guardar mi elección"; devuelve `changed` y la consulta después.

```ts
function answerChoice(context: BrowserContext, siteUrl: string, activityId: number, optionIds: number[]): Promise<{ changed: string; choice: Choice }>;
```

En una consulta múltiple, las opciones que no se dan se desmarcan, así que `optionIds` es la respuesta entera. Lanza `ChoiceError`, antes de guardar nada, cuando no se da ninguna opción, cuando la consulta no se puede responder ahora (cerrada, aún no abierta, o respondida y sin permitir cambios; el error repite la respuesta de la persona y el mensaje de Moodle), cuando se dan varias a una consulta simple, cuando un id de opción no es de la consulta (el error enumera sus opciones) y cuando una opción está completa.

## Ejemplo {#example}

```ts
import { SurveyError } from "@falkenslab/moodle-driver";

// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

// Una actividad de retroalimentación (módulo del curso 34): responder todas las preguntas obligatorias.
const survey = await moodle.getSurvey(34);
if (survey.canAnswer) {
  const responses: Record<string, string> = {};
  for (const question of survey.questions) {
    const field = question.fields[0];
    if (!field || !question.required) continue;
    if (field.kind === "text") responses[field.name] = "Clara y con buen ritmo.";
    else if (field.options?.length) responses[field.name] = field.options[0]!.value;
  }
  try {
    const { messages } = await moodle.submitSurvey(34, responses);
    console.log(messages.join(" "));
  } catch (error) {
    if (error instanceof SurveyError) console.error(error.message);
    else throw error;
  }
} else {
  console.log(`No se puede responder: ${survey.messages.join(" ")}`);
}

// Una consulta (módulo del curso 40): elegir la opción cuyo texto es "while".
const choice = await moodle.getChoice(40);
const option = choice.options.find((o) => o.text === "while" && !o.full);
if (choice.canAnswer && option) {
  const { choice: after } = await moodle.answerChoice(40, [option.id]);
  console.log(`Respuesta: ${after.answer.join(", ")}`);
}
```

## Categorías de datos {#data-categories}

- `getSurvey`, `getChoice`: `course-content` y `own` (la actividad y la respuesta de la persona).
- `submitSurvey`, `answerChoice`: `own`.

Consulta [Categorías de datos](../concepts/data-categories.md).

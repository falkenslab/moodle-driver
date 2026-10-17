# Encuestas y consultas

Responder encuestas y consultas como lo hace un estudiante: leer las preguntas de una encuesta con sus campos y rellenarla página a página, y leer las opciones de una consulta y elegir una o varias. Se admiten dos módulos de encuesta: el módulo Retroalimentación de Moodle (`feedback`) y el plugin Cuestionario (`questionnaire`, mod_questionnaire). El módulo "survey" más antiguo de Moodle (instrumentos fijos como COLLES y ATTLS) no. Un profesor también puede leer lo que respondieron todos: `surveyResults` para una encuesta y `choiceResults` para una consulta, de los informes que Moodle muestra a los profesores; y construir las preguntas de una retroalimentación: `feedbackItems`, `addFeedbackItem`, `editFeedbackItem`, `moveFeedbackItem`, `deleteFeedbackItem`, y sus plantillas.

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

- `activityId`: el id de la actividad (id del módulo del curso). `type`: su módulo, de la estructura del curso; sin él, el driver lo averigua por la página con la que responde cada módulo (una vez por actividad), a costa de una o dos páginas.
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

## surveyResults

Lo que respondieron las personas en una retroalimentación o un cuestionario, tal como sus informes se lo muestran a un profesor: cada respuesta, quién la dio salvo que sea anónima, y cada pregunta con la respuesta de cada envío, cuántos eligieron cada opción y la media de las respuestas numéricas.

```ts
function surveyResults(context: BrowserContext, siteUrl: string, activityId: number, options?: { type?: SurveyType }): Promise<SurveyResults>;

interface SurveyResults {
  id: number;
  type: SurveyType;
  responses: SurveyResponse[];
  questions: SurveyResultQuestion[];
}

interface SurveyResponse {
  id: number;
  anonymous: boolean;
  userId?: number;
  fullName?: string;
  number?: number;
}

interface SurveyResultQuestion {
  id: number;
  number?: string;
  text: string;
  type: string;
  answers: { responseId: number; values: string[] }[];
  counts?: SurveyOptionCount[];
  average?: number;
  rows?: { row: string; counts: SurveyOptionCount[]; average?: number }[];
}

interface SurveyOptionCount {
  option: string;
  count: number;
}
```

- `type`: el módulo de la actividad; sin él, se averigua como lo averigua `getSurvey`.
- `responses`: el id de cada respuesta en Moodle (la respuesta completada de una retroalimentación, la respuesta de un cuestionario), si se dio de forma anónima y, si no, quién la dio. Una retroalimentación nombra a las personas con su `userId` y su `fullName`, y numera sus respuestas anónimas (`number`, su "Número de respuesta"); el informe de un cuestionario nombra a las personas sin enlazarlas, así que sus respuestas solo llevan el `fullName`.
- `questions`: las preguntas que admiten respuesta, en el orden de la encuesta. `id` es el id del elemento de una retroalimentación o el id de la pregunta de un cuestionario; `type` es el propio del módulo (retroalimentación: `multichoice`, `multichoicerated`, `numeric`, `textfield`, `textarea`…; cuestionario: `radio`, `check`, `drop`, `yesno`, `rate`, `text`, `essay`, `numeric`, `date`…).
- `answers`: la respuesta de cada envío por su `responseId`: la opción u opciones elegidas, el texto o el número dados; el texto "otro" de un cuestionario va tras la opción y dos puntos, y las filas de una pregunta de valoración como `"fila: opción"`. Los envíos que dejaron la pregunta en blanco no aparecen.
- `counts`: en las preguntas de opciones, todas las opciones que ofrece la pregunta, en orden, con cuántas respuestas la eligieron (las que nadie eligió cuentan 0), contadas a partir de las respuestas como las cuenta el análisis de Moodle.
- `average`: en las preguntas numéricas, y en las opciones valoradas de una retroalimentación según los pesos de sus opciones, la media con dos decimales.
- `rows`: la pregunta de valoración de un cuestionario, cada fila con sus recuentos por columna y su posición media (los números de las propias columnas, o sus posiciones cuando tienen nombre).

Una retroalimentación se lee de su página de impresión (las preguntas y sus opciones), de sus tablas de "Mostrar respuestas" (quién respondió) y de las descargas CSV de esas tablas (todas las respuestas: las tablas muestran diez preguntas como mucho); necesita `mod/feedback:viewreports`, que tienen los profesores. Un cuestionario se lee de las respuestas individuales de su informe, una página por respuesta, en el orden de su lista de respuestas (también las que están en curso, como las muestra la lista); necesita `mod/questionnaire:readallresponses`, que tienen los profesores y también los estudiantes donde el cuestionario les deja ver todas las respuestas (su ajuste "Los estudiantes pueden ver TODAS las respuestas"). Lanza `SurveyError` cuando Moodle rechaza el informe o la página de un cuestionario no enlaza a él (como cuando nadie lo ha respondido aún) (el mensaje de Moodle y la capacidad están en el error), cuando el id no es una encuesta de ese módulo y cuando el plugin Cuestionario no está instalado en el sitio.

## feedbackItems

Los elementos de una retroalimentación tal como los construye su profesor en su página "Preguntas", en orden: las preguntas, las etiquetas y los elementos de información, y los saltos de página.

```ts
function feedbackItems(context: BrowserContext, siteUrl: string, activityId: number): Promise<FeedbackItemDefinition[]>;

type FeedbackItemType = "multichoice" | "multichoicerated" | "textfield" | "textarea" | "numeric" | "info" | "label" | "captcha" | "pagebreak";

interface FeedbackItemDefinition {
  id: number;
  type: FeedbackItemType;
  position: number;
  question: string;
  label?: string;
  required: boolean;
  options?: FeedbackItemOption[];
  display?: "radio" | "checkbox" | "dropdown";
  horizontal?: boolean;
  hideNotSelected?: boolean;
  ignoreEmpty?: boolean;
  range?: { from?: number; to?: number };
  info?: "response-time" | "course" | "category";
  contents?: string;
  dependsOn?: { itemId: number; value: string };
}

interface FeedbackItemOption {
  text: string;
  weight?: number;
}
```

- `type`: los nombres propios de Moodle (`FEEDBACK_ITEM_TYPES`), como los da `surveyResults`: opción múltiple (`multichoice`), opción múltiple valorada (`multichoicerated`), respuesta de texto corta (`textfield`), respuesta de texto larga (`textarea`), respuesta numérica (`numeric`), información (`info`), etiqueta (`label`), CAPTCHA (`captcha`) y salto de página (`pagebreak`).
- `id`: el id del elemento, el mismo que da `surveyResults` a su pregunta; `position`: su lugar, desde 1.
- `question`: el texto de la pregunta (vacío en una etiqueta o un salto de página); `label`: el campo "Etiqueta" de Moodle, un nombre corto del elemento en los informes y las dependencias.
- `options`: las opciones de una pregunta de opciones en orden, las de una valorada con su `weight`; `display`: botones de opción, casillas (varias respuestas, solo en opción múltiple) o una lista desplegable; `horizontal`, `hideNotSelected` (sin la opción "No seleccionada") e `ignoreEmpty` (las respuestas vacías fuera del análisis): los demás ajustes de la pregunta de opciones.
- `range`: el rango de un elemento numérico, cuando lo tiene; `info`: lo que muestra un elemento de información (la hora de la respuesta, el curso o su categoría); `contents`: el HTML de una etiqueta.
- `dependsOn`: el elemento solo se muestra cuando otro, por su id, se respondió con `value`.

Los elementos salen de la exportación de las preguntas de la retroalimentación (`export.php`), que necesita `mod/feedback:edititems` igual que construirlas (la tienen los profesores con permiso de edición); sin ella lanza `SurveyError` con el mensaje de Moodle, igual que cuando el id no es una retroalimentación. Una retroalimentación sin elementos se lee como ninguno.

## addFeedbackItem

Añade un elemento a una retroalimentación, como hacen su menú "Añadir pregunta" y el formulario del elemento.

```ts
function addFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, input: FeedbackItemInput & { after?: number }): Promise<{ changed: string; itemId: number; itemIds: number[] }>;

interface FeedbackItemInput {
  type: FeedbackItemType;
  question?: string;
  label?: string;
  required?: boolean;
  options?: (string | FeedbackItemOption)[];
  display?: "radio" | "checkbox" | "dropdown";
  horizontal?: boolean;
  hideNotSelected?: boolean;
  ignoreEmpty?: boolean;
  range?: { from?: number; to?: number };
  info?: "response-time" | "course" | "category";
  contents?: string;
  dependsOn?: { itemId: number; value: string } | null;
  fields?: Record<string, FieldValue>;
}
```

- `after`: el elemento tras el que va (0 lo pone el primero); por defecto va el último.
- `question`: todos los tipos salvo la etiqueta y el salto de página necesitan una; una etiqueta recibe `contents` (HTML).
- `options`: las opciones de una pregunta de opciones, una línea de texto cada una (sin `|`, el separador de Moodle); las de una valorada como `{ text, weight }`, con el peso como número entero (0 si se omite).
- `required`: no en los elementos de información, las etiquetas y los saltos de página, que Moodle nunca hace obligatorios. `info: "response-time"` solo donde la retroalimentación no es anónima, como lo ofrece Moodle.
- `dependsOn`: se muestra solo cuando otro elemento que admite respuesta se respondió con `value` (en Moodle, va en una página posterior a la de ese elemento).
- `fields`: cualquier otro campo del formulario del elemento por su nombre (`itemsize` e `itemmaxlength` de un texto corto, `itemwidth` e `itemheight` de uno largo…).
- Devuelve el id del elemento nuevo y los elementos de la retroalimentación en orden.

Un salto de página y un CAPTCHA no tienen formulario: Moodle los añade al final cuando se abre su enlace, y el driver los mueve luego adonde dice `after`. Moodle no añade un salto de página a una retroalimentación sin elementos ni justo tras otro salto de página al final, y un CAPTCHA como mucho (cuya comprobación solo funciona con las claves de reCAPTCHA del sitio). Lanza `SurveyError`, antes de guardar nada, para un tipo que el menú "Añadir pregunta" de la retroalimentación no ofrece, para lo que el tipo no admite (opciones en un elemento de texto, `required` en una etiqueta…) y para un elemento de `after` o de `dependsOn` que la retroalimentación no tiene; `FormError` con los mensajes de Moodle por campo cuando rechaza el formulario.

## editFeedbackItem

Cambia un elemento mediante su formulario con lo que se da; el resto queda como está.

```ts
function editFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number, changes: Partial<Omit<FeedbackItemInput, "type">>): Promise<{ changed: string; itemId: number }>;
```

Las `options` dadas las sustituyen todas; `dependsOn: null` quita la dependencia. Un elemento conserva su tipo y su lugar (`moveFeedbackItem` lo mueve). Un salto de página y un CAPTCHA no tienen nada que cambiar: `SurveyError`, igual que para un elemento que la retroalimentación no tiene, sin cambios o con lo que el tipo no admite.

## moveFeedbackItem

Mueve un elemento a una posición, desde 1, como lo hace el arrastrar y soltar de la página "Preguntas" (el servicio `mod_feedback_questions_reorder` de Moodle).

```ts
function moveFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number, position: number): Promise<{ changed: string; itemId: number; itemIds: number[] }>;
```

Devuelve los elementos en su nuevo orden. Lanza `SurveyError` para un elemento que la retroalimentación no tiene o una posición fuera de 1 al número de elementos.

## deleteFeedbackItem

Borra un elemento, como lo hace la acción de borrar de la página "Preguntas" una vez confirmada; las respuestas que se le dieron se van con él, como en Moodle.

```ts
function deleteFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number): Promise<{ changed: string; itemId: number; itemIds: number[] }>;
```

Devuelve los elementos que quedan, en orden; `SurveyError` para un elemento que la retroalimentación no tiene.

## Plantillas de retroalimentación {#feedback-templates}

Una plantilla guarda los elementos de una retroalimentación para usarlos en otra: las plantillas propias del curso, o públicas que puede usar cualquier curso.

```ts
function feedbackTemplates(context: BrowserContext, siteUrl: string, activityId: number): Promise<FeedbackTemplate[]>;
function saveFeedbackTemplate(context: BrowserContext, siteUrl: string, activityId: number, name: string, options?: { public?: boolean }): Promise<{ changed: string; templateId: number }>;
function useFeedbackTemplate(context: BrowserContext, siteUrl: string, activityId: number, templateId: number, options?: { replace?: boolean }): Promise<{ changed: string; itemIds: number[] }>;
function deleteFeedbackTemplate(context: BrowserContext, siteUrl: string, activityId: number, templateId: number): Promise<{ changed: string; templateId: number }>;

interface FeedbackTemplate {
  id: number;
  name: string;
  public: boolean;
}
```

- `feedbackTemplates`: las plantillas que puede usar la retroalimentación, primero las del curso, como las enumera su página "Plantillas".
- `saveFeedbackTemplate`: los elementos de la retroalimentación como plantilla nueva, como hace "Guardar como nueva plantilla": propia del curso, o pública con `public`, que necesita `mod/feedback:createpublictemplate` en todo el sitio (los gestores). Una del curso necesita `mod/feedback:createprivatetemplate`, que tienen los profesores con permiso de edición.
- `useFeedbackTemplate`: los elementos de la plantilla añadidos tras los de la retroalimentación, como hace "Usar esta plantilla"; con `replace`, en su lugar. El propio formulario de Moodle empieza sustituyéndolos; aquí está desactivado salvo que se pida, así que no se pierde nada sin pedirlo. Devuelve los elementos después.
- `deleteFeedbackTemplate`: como el borrado de la página "Plantillas" una vez confirmado; una pública necesita `mod/feedback:createpublictemplate` y `mod/feedback:deletetemplate` en todo el sitio.

Guardar y usar pasan por los formularios dinámicos de Moodle (el servicio `core_form_dynamic_form`), como sus diálogos. Cada una lanza `SurveyError` para una plantilla que la retroalimentación no puede usar, para una retroalimentación sin elementos que guardar y cuando Moodle lo rechaza (la capacidad está en el error).

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

- `id`: el id del módulo del curso dado; `name` e `intro`: el nombre y la descripción de la actividad.
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

## choiceResults

Las respuestas de una consulta, tal como su informe de respuestas se las muestra a un profesor: cada opción con cuántos la eligieron y quiénes.

```ts
function choiceResults(context: BrowserContext, siteUrl: string, activityId: number): Promise<ChoiceResults>;

interface ChoiceResults {
  id: number;
  options: { id?: number; text: string; count: number; users: ChoiceRespondent[] }[];
  notAnswered?: ChoiceRespondent[];
}

interface ChoiceRespondent {
  userId: number;
  fullName: string;
}
```

- `options`: en el orden de la consulta, cada una con su id (lo que recibe `answerChoice`), su texto, su recuento y las personas que la eligieron. El id sale de las casillas "seleccionar todo" del informe, que solo tienen quienes pueden borrar respuestas (`mod/choice:deleteresponses`, como los profesores); sin ellas falta.
- `notAnswered`: quiénes no han respondido, cuando la consulta los muestra (su ajuste "Mostrar columna de no respondidas"), reconocidos por las mismas casillas.
- El informe nombra a las personas publique lo que publique la consulta: su ajuste "Publicar resultados" trata de lo que ven los estudiantes.

Cuando nadie ha respondido, Moodle no muestra tabla: las opciones salen de la página de la consulta, cada una con un recuento de 0. Necesita `mod/choice:readresponses`, que tienen los profesores; lanza `ChoiceError` con el mensaje de Moodle cuando se rechaza o el id no es una consulta.

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

Como profesor, los resultados de las mismas actividades:

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

// Quién respondió la retroalimentación (módulo del curso 34) y cuántos eligieron cada opción de cada pregunta.
const results = await moodle.surveyResults(34);
for (const response of results.responses) console.log(response.anonymous ? `Respuesta anónima ${response.number}` : response.fullName);
for (const question of results.questions) {
  const counts = question.counts?.map((c) => `${c.option}: ${c.count}`).join(", ");
  console.log(`${question.text}: ${counts ?? question.answers.map((a) => a.values.join(" / ")).join(" | ")}${question.average !== undefined ? ` (media ${question.average})` : ""}`);
}

// Quién eligió qué en la consulta (módulo del curso 40).
const { options } = await moodle.choiceResults(40);
for (const option of options) console.log(`${option.text} (${option.count}): ${option.users.map((u) => u.fullName).join(", ")}`);
```

Como profesor, construir las preguntas de una retroalimentación y guardarlas como plantilla:

```ts
// `moodle` es el objeto de createMoodle(), como en las páginas de primeros pasos.

// Una retroalimentación (módulo del curso 34): una pregunta de opciones obligatoria, una valorada y luego una segunda página con una respuesta de texto.
const help = await moodle.addFeedbackItem(34, { type: "multichoice", question: "¿Te ayudó el curso?", required: true, options: ["Sí", "No"] });
await moodle.addFeedbackItem(34, { type: "multichoicerated", question: "El ritmo", options: [{ text: "Demasiado lento", weight: 1 }, { text: "Adecuado", weight: 3 }, { text: "Demasiado rápido", weight: 1 }] });
await moodle.addFeedbackItem(34, { type: "pagebreak" });
await moodle.addFeedbackItem(34, { type: "textarea", question: "¿Qué cambiarías?" });
// Un texto de bienvenida al principio, y la primera pregunta con otras palabras.
await moodle.addFeedbackItem(34, { type: "label", contents: "<p>Gracias por tu tiempo.</p>", after: 0 });
await moodle.editFeedbackItem(34, help.itemId, { question: "¿Te ayudó este curso?" });
for (const item of await moodle.feedbackItems(34)) console.log(`${item.position}. ${item.type} ${item.question}`);

// Guardadas como plantilla del curso y usadas luego en otra retroalimentación (módulo del curso 35).
const { templateId } = await moodle.saveFeedbackTemplate(34, "Fin de curso");
await moodle.useFeedbackTemplate(35, templateId);
```

## Categorías de datos {#data-categories}

- `getSurvey`, `getChoice`: `course-content` y `own` (la actividad y la respuesta de la persona).
- `submitSurvey`, `answerChoice`: `own`.
- `surveyResults`, `choiceResults`: `course-content`, `others-aggregate` y `others-personal` (la actividad, sus recuentos y las respuestas de todos con sus nombres).
- `feedbackItems`, `addFeedbackItem`, `editFeedbackItem`, `moveFeedbackItem`, `deleteFeedbackItem`, `feedbackTemplates`, `saveFeedbackTemplate`, `useFeedbackTemplate`, `deleteFeedbackTemplate`: `course-content`.

Consulta [Categorías de datos](../concepts/data-categories.md).

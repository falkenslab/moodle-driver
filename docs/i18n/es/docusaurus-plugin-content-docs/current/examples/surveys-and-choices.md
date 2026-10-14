# Responder una encuesta y una consulta {#answer-a-survey-and-a-choice}

Un programa para un estudiante que responde en el terminal una encuesta de feedback de un curso y una actividad de consulta: muestra cada pregunta y sus opciones, envía lo que escribe la persona e imprime lo que dice Moodle después.

**Usa:** [encuestas y consultas](../areas/surveys-and-choices.md).

## El programa {#the-program}

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, SurveyError, type SurveyField } from "@falkenslab/moodle-driver";

// Ids de módulos del curso, de courseStructure(): una actividad feedback (tipo "feedback") y una consulta (tipo "choice").
const SURVEY_ID = 34;
const CHOICE_ID = 40;

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
});
await moodle.logIn();
const prompt = createInterface({ input: process.stdin, output: process.stdout });

// La respuesta a un campo: el número de una opción, una marca o un texto; vacío lo deja sin responder.
async function ask(field: SurveyField): Promise<string | undefined> {
  if (field.kind === "text") return (await prompt.question("  > ")) || undefined;
  if (field.kind === "checkbox") return /^s/i.test(await prompt.question(`  ${field.label ?? ""} (s/n) `)) ? "1" : undefined;
  if (field.label) console.log(`  ${field.label}`);
  field.options?.forEach((option, i) => console.log(`  ${i + 1}) ${option.label}`));
  return field.options?.[Number(await prompt.question("  Número: ")) - 1]?.value;
}

// Dar el módulo ahorra averiguarlo desde la página; "questionnaire" es el otro módulo de encuestas admitido.
const survey = await moodle.getSurvey(SURVEY_ID, "feedback");
if (!survey.canAnswer) {
  console.log(`Encuesta: ${survey.messages.join(" ")}`);
} else {
  console.log(survey.intro);
  // Las preguntas de todas las páginas, leídas de antemano: las respuestas van por nombre en el formulario, estén en la página que estén.
  const responses: Record<string, string> = {};
  for (const question of survey.questions) {
    console.log(`\n${question.number ?? ""} ${question.text}${question.required ? " (obligatoria)" : ""}`);
    for (const field of question.fields) {
      const value = await ask(field);
      if (value !== undefined) responses[field.name] = value;
    }
  }
  try {
    // Rellena cada página con sus respuestas y envía en la última, como lo haría la persona.
    const { changed, messages } = await moodle.submitSurvey(SURVEY_ID, responses, { type: "feedback" });
    console.log(`${changed} ${messages.join(" ")}`);
  } catch (error) {
    // Moodle devolvió una página (una pregunta obligatoria sin responder): sus mensajes están en el error.
    if (error instanceof SurveyError) console.log(`No se ha enviado: ${error.message}`);
    else throw error;
  }
}

const choice = await moodle.getChoice(CHOICE_ID);
console.log(`\n${choice.name}\n${choice.intro}`);
if (!choice.canAnswer) {
  console.log(`${choice.messages.join(" ")} Tu respuesta: ${choice.answer.join(", ") || "ninguna"}`);
} else {
  // Las opciones llenas (alcanzado un límite de respuestas) no se pueden elegir.
  const open = choice.options.filter((o) => !o.full);
  open.forEach((option, i) => console.log(`  ${i + 1}) ${option.text}${option.selected ? " *" : ""}`));
  const typed = await prompt.question(choice.multiple ? "Números, separados por comas: " : "Número: ");
  const ids = typed.split(",").flatMap((n) => open[Number(n) - 1]?.id ?? []);
  // En una consulta múltiple las opciones que se quedan fuera se desmarcan: ids es la respuesta completa.
  if (ids.length > 0) console.log((await moodle.answerChoice(CHOICE_ID, ids)).changed);
}
prompt.close();
```

## Paso a paso {#step-by-step}

1. `logIn()` abre una ventana la primera vez para que la persona inicie sesión.
2. `getSurvey(SURVEY_ID, "feedback")` lee la página de la actividad y, cuando la persona puede responder (`canAnswer`), todas las páginas de su formulario. Cada pregunta tiene su `text`, si es `required` y sus `fields` por nombre en el formulario. Cuando la persona ya ha respondido, o la encuesta está cerrada, `messages` lo dice.
3. El programa pide cada campo en el terminal y guarda las respuestas por nombre de campo. `submitSurvey` comprueba primero cada nombre contra el formulario (uno erróneo hace que no se envíe nada), después rellena las páginas con su botón "Página siguiente" y envía en la última.
4. `getChoice(CHOICE_ID)` lee la página de la consulta: sus opciones con sus ids, si se pueden elegir varias (`multiple`) y la respuesta actual de la persona (`selected`, `answer`).
5. `answerChoice(CHOICE_ID, ids)` guarda las opciones como lo hace "Guardar mi elección" y devuelve `changed` y la consulta tal como queda.

## Lo que imprime {#what-it-prints}

Un ejemplo; los textos son los de las actividades.

```text
Cuéntanos qué tal fue la primera unidad.

1 ¿Cómo de claras fueron las explicaciones? (obligatoria)
  1) Nada
  2) Algo
  3) Mucho
  Número: 3

2 ¿Qué cambiarías?
  > Más ejercicios de recursividad.
Submitted feedback 34. Gracias. Sus respuestas han sido guardadas.

Grupo de prácticas
Elige la sesión de prácticas a la que vas a ir.
  1) Lunes 10:00
  2) Miércoles 16:00 *
Número: 1
Answered choice 40: Lunes 10:00.
```

## Variaciones {#variations}

- Un questionnaire (mod_questionnaire) en su lugar: da `"questionnaire"` a las dos llamadas, o ningún tipo y deja que el driver lo averigüe a costa de una o dos páginas. Sus tablas de valoración llegan como un campo `choice` por fila.
- Respuestas preparadas en vez del terminal: rellena `responses` por nombre de campo (`await moodle.submitSurvey(34, { "multichoice_12": "3" })`), tomando los nombres de `getSurvey` una vez.
- Consultar la respuesta sin cambiarla: `(await moodle.getChoice(40)).answer` enumera las opciones elegidas por su texto, también una vez cerrada la consulta.

## Cuando algo sale mal {#when-something-goes-wrong}

- `SurveyError` de `getSurvey`: el id no es una actividad de ese módulo que la persona pueda abrir; comprueba su tipo en la estructura del curso.
- `SurveyError` de `submitSurvey`: nombres de campo desconocidos (no se envía nada), la encuesta no se puede responder ahora, o Moodle devolvió una página con mensajes por campo. Tras un error del servidor (5xx), Moodle puede haber guardado las respuestas o no: vuelve a leer la encuesta antes de reintentarlo.
- `ChoiceError` de `getChoice` o `answerChoice`: no es una consulta que la persona pueda abrir, está cerrada o aún no abierta, ya está respondida donde no se permiten cambios, hay varias opciones en una consulta simple o una opción está llena. No se guarda nada.
- `NotLoggedInError`: la sesión caducó mientras la persona escribía. Llama a `moodle.logIn()` y vuelve a ejecutarlo. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`getSurvey` y `getChoice` son `course-content` y `own`; `submitSurvey` y `answerChoice` son `own`. Consulta [categorías de datos](../concepts/data-categories.md).

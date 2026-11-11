# Responder un cuestionario {#answer-a-quiz}

Un programa para un estudiante que empieza un intento de un cuestionario (o continúa el que está en curso), muestra sus preguntas página a página en el terminal, guarda las respuestas que escribe la persona y, cuando esta lo confirma, termina el intento e imprime su revisión.

**Usa:** [cuestionarios](../areas/quizzes.md); consulta también [Trabajar al ritmo de un estudiante](../concepts/student-pace.md).

## El programa {#the-program}

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, type AttemptPage } from "@falkenslab/moodle-driver";

// El id del módulo del curso del cuestionario: una actividad de tipo "quiz" en courseStructure() (mod/quiz/view.php?id=26).
const QUIZ_ID = 26;

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  // Una persona lee y responde en el terminal, a su ritmo: las pausas de lectura del driver solo se sumarían.
  trail: "fast",
});
await moodle.logIn();

const info = await moodle.quizInfo(QUIZ_ID);
console.log(info.info.join("\n"));
if (!info.canStart) throw new Error(`No se puede intentar el cuestionario: ${info.messages.join(" ")}`);

// Empieza un intento, o continúa el abierto; aquí arranca el reloj de un límite de tiempo. Vuelve la página en la que se abre.
let at: AttemptPage = await moodle.startQuizAttempt(QUIZ_ID);
const attemptId = at.attemptId;
const prompt = createInterface({ input: process.stdin, output: process.stdout });

// Una página cada vez, como avanza una persona por el intento, hasta que está en su resumen (sin `page`).
while (at.page !== undefined) {
  console.log(`\n--- Página ${at.page + 1} de ${at.pages} ---`);
  const answers: { slot: number; responses: Record<string, string> }[] = [];
  for (const question of at.questions) {
    console.log(`\n${question.number ?? ""} ${question.text}`);
    // Las respuestas van por los nombres de los campos en el formulario (q9:1_answer); `value` es lo ya guardado.
    const responses: Record<string, string> = {};
    for (const field of question.fields) {
      if (field.kind === "text") {
        const typed = await prompt.question(`  Respuesta${field.value ? ` [${field.value}]` : ""}: `);
        if (typed) responses[field.name] = typed;
      } else if (field.kind === "checkbox") {
        const typed = await prompt.question(`  [${field.value === "1" ? "x" : " "}] ${field.label ?? ""} (s/n) `);
        if (typed) responses[field.name] = /^s/i.test(typed) ? "1" : "0";
      } else {
        // Botones de opción y desplegables: fuera "borrar mi elección" (-1) y el "Elegir..." de un desplegable (0); un falso también es "0".
        const options = (field.options ?? []).filter((o) => o.value !== "-1" && !(field.kind === "select" && o.value === "0"));
        if (field.label) console.log(`  ${field.label}`);
        options.forEach((option, i) => console.log(`  ${i + 1}) ${option.label}${option.value === field.value ? " *" : ""}`));
        const chosen = options[Number(await prompt.question("  Número (vacío para saltar): ")) - 1];
        if (chosen) responses[field.name] = chosen.value;
      }
    }
    if (Object.keys(responses).length > 0) answers.push({ slot: question.slot, responses });
  }
  if (answers.length > 0) {
    // Guarda esta página como lo hace su botón "Página siguiente" y da la página siguiente (o el resumen); el intento sigue abierto.
    at = await moodle.answerQuizQuestions(attemptId, answers);
    console.log(`Respuestas guardadas en ${answers.length} pregunta(s).`);
  } else if (at.page + 1 < at.pages) {
    // Nada que guardar: a la página siguiente, como lo hace su enlace en la navegación del intento.
    at = await moodle.readAttempt(attemptId, { page: at.page + 1 });
  } else {
    break;
  }
}

// Las filas del resumen, cuando el intento llegó a él: el estado de cada pregunta, en el idioma del sitio.
if (at.summary) console.log("");
for (const row of at.summary ?? []) console.log(`${row.number}: ${row.status}`);

const confirm = await prompt.question("\n¿Enviar todo y terminar? (sí/no) ");
prompt.close();
if (/^s(í|i)?$/i.test(confirm.trim())) {
  const done = await moodle.finishQuizAttempt(attemptId);
  // La revisión solo está cuando las opciones de revisión del cuestionario la muestran justo después del intento.
  if (!done.review) console.log(`${done.changed} La revisión aún no está disponible.`);
  for (const row of done.review?.summary ?? []) console.log(`${row.label}: ${row.value}`);
  for (const q of done.review?.questions ?? []) console.log(`${q.number ?? "-"} ${q.state}${q.mark ? ` (${q.mark})` : ""}${q.rightAnswer ? `: ${q.rightAnswer}` : ""}`);
} else {
  console.log(`El intento ${attemptId} sigue abierto: vuelve a ejecutarlo para continuarlo.`);
}
```

## Paso a paso {#step-by-step}

1. `createMoodle` recibe `trail: "fast"`: aquí quien lee es una persona, así que no hacen falta las pausas que el rastro realista añade para un programa que responde solo. Consulta [Trabajar al ritmo de un estudiante](../concepts/student-pace.md).
2. `logIn()` abre una ventana la primera vez para que la persona inicie sesión.
3. `quizInfo(QUIZ_ID)` lee la página del cuestionario: sus líneas de información, los intentos de la persona y `canStart`, que es false cuando se han agotado los intentos o el cuestionario está cerrado (`messages` dice por qué).
4. `startQuizAttempt` pulsa el botón de empezar (o continuar) del cuestionario, confirma el formulario del límite de tiempo si lo hay y da la página en la que se abre el intento (la página 0 para un intento nuevo, donde se dejó para uno en curso): su `page`, el número de páginas del intento en `pages` y las `questions` de esa página, cada una con su `slot` y sus `fields`. No lee las demás páginas: cada página que carga un programa es una visita en los registros del curso.
5. En cada página, el programa muestra las preguntas y pide cada campo: un texto, una marca o el número de una opción. Después `answerQuizQuestions(attemptId, answers)` guarda esa página con su botón "Página siguiente" y da adónde lleva: la página siguiente, o el resumen después de la última. Una página que se deja en blanco no se guarda: `readAttempt(attemptId, { page })` pasa a la siguiente. Moodle conserva lo guardado, así que parar a medias no pierde nada.
6. Pasada la última página, el intento está en su resumen: `at.page` es undefined y `at.summary` da el estado de cada pregunta, que el programa imprime.
7. Cuando la persona lo confirma, `finishQuizAttempt` envía el intento ("Enviar todo y terminar") y devuelve la revisión, si el cuestionario la muestra ya: el resumen (estado, puntos, calificación) y el estado, la puntuación y la respuesta correcta de cada pregunta.

## Lo que imprime {#what-it-prints}

Un ejemplo; las preguntas, las etiquetas y las calificaciones vienen del sitio.

```text
Intentos permitidos: 2
Límite de tiempo: 20 minutos
Método de calificación: Calificación más alta

--- Página 1 de 2 ---

1 La recursividad siempre necesita un caso base.
  1) Verdadero
  2) Falso
  Número (vacío para saltar): 1

2 ¿Qué devuelve factorial(4)?
  Respuesta: 24
Respuestas guardadas en 2 pregunta(s).

--- Página 2 de 2 ---

3 ¿Cuáles de estos son bucles en Python?
  [ ] for (s/n) s
  [ ] while (s/n) s
  [ ] repeat (s/n) n
Respuestas guardadas en 1 pregunta(s).

1: Respuesta guardada
2: Respuesta guardada
3: Respuesta guardada

¿Enviar todo y terminar? (sí/no) sí
Estado: Finalizado
Puntos: 3,00/3,00
Calificación: 10,00 de 10,00 (100%)
1 correct (Puntúa 1,00 sobre 1,00): La respuesta correcta es 'Verdadero'
2 correct (Puntúa 1,00 sobre 1,00): La respuesta correcta es: 24
3 correct (Puntúa 1,00 sobre 1,00): Las respuestas correctas son: for, while
```

## Variaciones {#variations}

- Continuar más tarde: vuelve a ejecutarlo. `startQuizAttempt` continúa el intento abierto, y el `value` guardado de cada campo aparece marcado (`*`, `[x]` o entre corchetes).
- Responder desde un archivo en vez del terminal: construye la misma lista `{ slot, responses }` y guárdala en una llamada; con el rastro realista por defecto, el driver hace entonces una pausa en cada página como lo haría quien lee.
- Leer la revisión de un intento anterior: toma su id de `info.attempts` (los que tienen `inProgress: false`) y llama a `await moodle.readReview(id)`.
- Leer el intento abierto sin empezar nada: `await moodle.readAttempt(attemptId)` da la página en la que está su pestaña (la página 0 cuando no hay ninguna pestaña suya abierta), y `await moodle.readAttempt(attemptId, { page: 1 })` su segunda página. Cada página cargada es una visita en los registros, así que lee solo las páginas que el programa necesita.

## Cuando algo sale mal {#when-something-goes-wrong}

- `QuizError` de `startQuizAttempt`: el cuestionario pide una contraseña (no admitido), no hay botón de empezar (intentos agotados, cerrado) o el id no es un cuestionario; el mensaje lleva los motivos de la página.
- `QuizError` de `answerQuizQuestions`, `readAttempt` o `finishQuizAttempt`: el intento ya no está abierto (se acabó el límite de tiempo, o se terminó en otro sitio) o un slot no está en él.
- `FormError` de `answerQuizQuestions`: el nombre de un campo no está en su página; esa página y las siguientes no se guardan, las anteriores sí.
- `NotLoggedInError`: la sesión caducó mientras la persona respondía. Llama a `moodle.logIn()` y vuelve a ejecutarlo: el intento continúa con lo guardado. Consulta [Errores](../concepts/errors.md).

## Datos que toca {#data-it-touches}

`quizInfo` es `course-content` y `own`; `startQuizAttempt`, `readAttempt`, `answerQuizQuestions` y `finishQuizAttempt` son `own`. Consulta [categorías de datos](../concepts/data-categories.md).

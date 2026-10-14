# Importar preguntas a un cuestionario {#import-questions-into-a-quiz}

Un profesor escribe unas cuantas preguntas en GIFT, las importa a una categoría del banco de preguntas compartido del curso y las añade a un cuestionario junto con una pregunta aleatoria sacada de una categoría de reserva.

**Usa:** [Bancos de preguntas](../areas/question-banks.md), [Cuestionarios](../areas/quizzes.md).

## El programa {#the-program}

```ts
import { createMoodle, FormError, NotLoggedInError, QuestionBankError, QuizError } from "@falkenslab/moodle-driver";

// El id de actividad del banco de preguntas compartido, de moodle.questionBanks(3) (o mod/qbank/view.php?id=52).
const BANK_ID = 52;
// El id de actividad del cuestionario (id del módulo del curso), de su dirección: mod/quiz/view.php?id=41.
const QUIZ_ID = 41;
// Categorías de ese banco, por nombre: una para estas preguntas y otra que ya contiene una reserva para preguntas aleatorias.
const TARGET_CATEGORY = "Unidad 4: Recursividad";
const POOL_CATEGORY = "Unidad 4: Reserva de práctica";

// GIFT: ::nombre:: texto {respuestas}. Las líneas en blanco separan las preguntas.
const gift = `
::Caso base:: Toda función recursiva necesita un caso base para detenerse. {T}

::Factorial de cero:: ¿Qué devuelve factorial(0)? {=1 ~0 ~Nunca devuelve nada}

::Llamadas:: ¿Cuántas llamadas hace factorial(3), contando la primera? {#4}

::Nombre:: ¿Cómo se llama una función que se llama a sí misma? {=recursiva =una función recursiva}
`;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });

try {
  await moodle.logIn();

  // Las categorías del banco por id; la primera es "Superior", que no contiene preguntas.
  const { categories } = await moodle.questions(BANK_ID);
  const target = categories.find((c) => c.name === TARGET_CATEGORY);
  const pool = categories.find((c) => c.name === POOL_CATEGORY);
  if (!target || !pool) throw new Error(`El banco ${BANK_ID} no tiene la categoría "${TARGET_CATEGORY}" o "${POOL_CATEGORY}": créalas antes en Moodle.`);

  // Con categoryId, todo va a parar a esa categoría, diga lo que diga el archivo.
  const imported = await moodle.importQuestions(BANK_ID, { format: "gift", text: gift, categoryId: target.id });
  console.log(imported.changed);

  // Las preguntas importadas por id, y una pregunta aleatoria de la reserva, al final del cuestionario.
  const result = await moodle.addQuestionsToQuiz(QUIZ_ID, {
    questionIds: imported.questions.map((q) => q.id),
    random: { categoryId: pool.id, count: 1 },
  });
  console.log(result.changed);

  // El cuestionario tal como queda, posición a posición; una posición aleatoria no tiene questionId.
  for (const slot of result.slots) console.log(`  página ${slot.page}  #${slot.number ?? "-"}  [${slot.type}] ${slot.name}  ${slot.mark ?? ""}`);
} catch (error) {
  if (error instanceof QuestionBankError || error instanceof QuizError) console.error(`${error.code}: ${error.message}`);
  else if (error instanceof FormError) for (const { field, message } of error.fields) console.error(`${field}: ${message}`);
  else if (error instanceof NotLoggedInError) console.error("No hay sesión: vuelve a ejecutarlo para iniciar sesión.");
  else throw error;
}
```

## Paso a paso {#step-by-step}

1. `BANK_ID` es el id de actividad del banco compartido: `questionBanks(courseId)` enumera los bancos del curso, con `shared: true` para uno compartido (`type: "qbank"`). `QUIZ_ID` es el id de actividad del cuestionario, el `id` de su dirección. Cada cuestionario tiene además un banco propio, así que `BANK_ID` podría ser `QUIZ_ID` para guardar las preguntas solo en el cuestionario.
2. `logIn()` abre una ventana la primera vez para que el profesor inicie sesión; las siguientes ejecuciones reutilizan la sesión.
3. `questions` lee las categorías del banco (y sus preguntas, que aquí no se usan). El programa busca las dos categorías por nombre y se detiene si falta alguna, antes de importar nada.
4. `importQuestions` sube el texto GIFT como archivo a través del formulario de importación del banco, como lo haría el profesor. Con `categoryId`, las preguntas van a esa categoría; el resultado enumera las preguntas creadas, con sus ids y tipos (`truefalse`, `multichoice`, `numerical`, `shortanswer`).
5. `addQuestionsToQuiz` añade esas preguntas por id y una pregunta aleatoria de la categoría de reserva, al final del cuestionario, como hace la página de edición del cuestionario. Responde con las posiciones del cuestionario tal como quedan.
6. El programa imprime cada posición: su página, su número en el cuestionario, su tipo (`"random"` para la aleatoria) y su puntuación máxima.

## Lo que imprime {#what-it-prints}

Una ejecución de ejemplo:

```text
Imported 4 questions into bank 52.
Added 5 questions to quiz 41.
  página 1  #1  [truefalse] Caso base  1.00
  página 1  #2  [multichoice] Factorial de cero  1.00
  página 1  #3  [numerical] Llamadas  1.00
  página 1  #4  [shortanswer] Nombre  1.00
  página 1  #5  [random] Aleatoria (Unidad 4: Reserva de práctica)  1.00
```

## Variaciones {#variations}

- Importar desde un archivo en vez de un texto: `{ format: "gift", file: "/home/teacher/unidad-4/preguntas.gift", categoryId: target.id }`, o `format: "xml"` para Moodle XML.
- Varias preguntas aleatorias, con las subcategorías de la reserva: `random: { categoryId: pool.id, count: 3, includeSubcategories: true }`.
- Añadirlas a una página existente en vez de al final: `page: 2`, un número de página tal como los da `quizStructure(QUIZ_ID)` en el `page` de cada posición.
- Una pregunta con su propia retroalimentación por respuesta, sin GIFT: `createQuestion(BANK_ID, { type: "multichoice", name, text, answers, categoryId: target.id })`, y después añade su `questionId`.

## Cuando algo sale mal {#when-something-goes-wrong}

- `QuestionBankError` (código `question-bank`): `BANK_ID` no es un módulo que guarde preguntas (el driver lo comprueba antes de abrir su banco, así que no queda nada a medias), el profesor no puede gestionar sus preguntas, la categoría no está en el banco, o Moodle no pudo analizar el GIFT ("Moodle didn't import the questions: ..."), y en ese caso no se importó nada.
- `QuizError` (código `quiz`): el cuestionario ya tiene intentos, así que Moodle no deja cambiar sus preguntas (crea un cuestionario nuevo, o borra los intentos en Moodle); o no se añadió ninguna pregunta (ids o categoría equivocados). Las preguntas importadas antes se quedan en el banco: vuelve a ejecutar solo la segunda mitad.
- `FormError`: Moodle rechazó el formulario de importación; sus `fields` contienen los mensajes de Moodle.
- `NotLoggedInError`: la sesión caducó; vuelve a ejecutarlo e inicia sesión.

## Datos que toca {#data-it-touches}

`questions`, `importQuestions` y `addQuestionsToQuiz` son `course-content`: preguntas y cuestionarios que escriben los profesores, ni intentos ni respuestas de nadie. Consulta [categorías de datos](../concepts/data-categories.md).

# Import questions into a quiz

A teacher writes a few questions in GIFT, imports them into a category of the course's shared question bank, and adds them to a quiz together with a random question drawn from a pool category.

**Uses:** [Question banks](../areas/question-banks.md), [Quizzes](../areas/quizzes.md).

## The program

```ts
import { createMoodle, FormError, NotLoggedInError, QuestionBankError, QuizError } from "@falkenslab/moodle-driver";

// The shared question bank's activity id, from moodle.questionBanks(3) (or mod/qbank/view.php?id=52).
const BANK_ID = 52;
// The quiz's activity id (course module id), from its address: mod/quiz/view.php?id=41.
const QUIZ_ID = 41;
// Categories of that bank, by name: one for these questions, one already holding a pool for random questions.
const TARGET_CATEGORY = "Unit 4: Recursion";
const POOL_CATEGORY = "Unit 4: Practice pool";

// GIFT: ::name:: text {answers}. Blank lines separate questions.
const gift = `
::Base case:: Every recursive function needs a base case to stop. {T}

::Factorial of zero:: What does factorial(0) return? {=1 ~0 ~It never returns}

::Calls:: How many calls does factorial(3) make, counting the first one? {#4}

::Name:: What is a function that calls itself called? {=recursive =a recursive function}
`;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });

try {
  await moodle.logIn();

  // The bank's categories by id; the first is "Top", which holds no questions.
  const { categories } = await moodle.questions(BANK_ID);
  const target = categories.find((c) => c.name === TARGET_CATEGORY);
  const pool = categories.find((c) => c.name === POOL_CATEGORY);
  if (!target || !pool) throw new Error(`Bank ${BANK_ID} has no "${TARGET_CATEGORY}" or "${POOL_CATEGORY}" category: create them in Moodle first.`);

  // With categoryId, everything lands in that category, whatever the file says.
  const imported = await moodle.importQuestions(BANK_ID, { format: "gift", text: gift, categoryId: target.id });
  console.log(imported.changed);

  // The imported questions by id, and one random question from the pool, at the end of the quiz.
  const result = await moodle.addQuestionsToQuiz(QUIZ_ID, {
    questionIds: imported.questions.map((q) => q.id),
    random: { categoryId: pool.id, count: 1 },
  });
  console.log(result.changed);

  // The quiz afterwards, slot by slot; a random slot has no questionId.
  for (const slot of result.slots) console.log(`  page ${slot.page}  #${slot.number ?? "-"}  [${slot.type}] ${slot.name}  ${slot.mark ?? ""}`);
} catch (error) {
  if (error instanceof QuestionBankError || error instanceof QuizError) console.error(`${error.code}: ${error.message}`);
  else if (error instanceof FormError) for (const { field, message } of error.fields) console.error(`${field}: ${message}`);
  else if (error instanceof NotLoggedInError) console.error("No session: run again to log in.");
  else throw error;
}
```

## Step by step

1. `BANK_ID` is the shared bank's activity id: `questionBanks(courseId)` lists the course's banks, with `shared: true` for a shared one (`type: "qbank"`). `QUIZ_ID` is the quiz's activity id, the `id` in its address. Every quiz also has a bank of its own, so `BANK_ID` could be `QUIZ_ID` to keep the questions in the quiz only.
2. `logIn()` opens a window the first time for the teacher to log in; later runs reuse the session.
3. `questions` reads the bank's categories (and its questions, unused here). The program finds the two categories by name and stops if either is missing, before importing anything.
4. `importQuestions` uploads the GIFT text as a file through the bank's import form, as the teacher would. With `categoryId`, the questions go to that category; the result lists the questions created, with their ids and types (`truefalse`, `multichoice`, `numerical`, `shortanswer`).
5. `addQuestionsToQuiz` adds those questions by id and one random question from the pool category, at the end of the quiz, as the quiz's edit page does. It answers with the quiz's slots afterwards.
6. The program prints each slot: its page, its number in the quiz, its type (`"random"` for the random one) and its maximum mark.

## What it prints

An example run:

```text
Imported 4 questions into bank 52.
Added 5 questions to quiz 41.
  page 1  #1  [truefalse] Base case  1.00
  page 1  #2  [multichoice] Factorial of zero  1.00
  page 1  #3  [numerical] Calls  1.00
  page 1  #4  [shortanswer] Name  1.00
  page 1  #5  [random] Random (Unit 4: Practice pool)  1.00
```

## Variations

- Import from a file instead of text: `{ format: "gift", file: "/home/teacher/unit-4/questions.gift", categoryId: target.id }`, or `format: "xml"` for Moodle XML.
- Several random questions, with the pool's subcategories: `random: { categoryId: pool.id, count: 3, includeSubcategories: true }`.
- Add them to an existing page instead of the end: `page: 2`, a page number as `quizStructure(QUIZ_ID)` gives them in each slot's `page`.
- One question with its own feedback per answer, without GIFT: `createQuestion(BANK_ID, { type: "multichoice", name, text, answers, categoryId: target.id })`, then add its `questionId`.

## When something goes wrong

- `QuestionBankError` (code `question-bank`): `BANK_ID` isn't a module that keeps questions (the driver checks before opening its bank, so nothing is left behind), the teacher can't manage its questions, the category isn't in the bank, or Moodle couldn't parse the GIFT ("Moodle didn't import the questions: ..."), in which case nothing was imported.
- `QuizError` (code `quiz`): the quiz already has attempts, so Moodle doesn't let its questions change (make a new quiz, or delete the attempts in Moodle); or no question was added (wrong ids or category). The questions imported before stay in the bank: run only the second half again.
- `FormError`: Moodle refused the import form; its `fields` hold Moodle's messages.
- `NotLoggedInError`: the session expired; run again and log in.

## Data it touches

`questions`, `importQuestions` and `addQuestionsToQuiz` are `course-content`: questions and quizzes teachers write, nobody's attempts or answers. See [data categories](../concepts/data-categories.md).

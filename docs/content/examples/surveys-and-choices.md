# Answer a survey and a choice

A program for a student that answers a course's feedback survey and a choice activity at the terminal: it shows each question and its options, sends what the person types, and prints what Moodle says afterwards.

**Uses:** [surveys and choices](../areas/surveys-and-choices.md).

## The program

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, SurveyError, type SurveyField } from "@falkenslab/moodle-driver";

// Course module ids, from courseStructure(): a feedback activity (type "feedback") and a choice (type "choice").
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

// One field's answer: an option's number, a tick or a text; empty leaves it unanswered.
async function ask(field: SurveyField): Promise<string | undefined> {
  if (field.kind === "text") return (await prompt.question("  > ")) || undefined;
  if (field.kind === "checkbox") return /^y/i.test(await prompt.question(`  ${field.label ?? ""} (y/n) `)) ? "1" : undefined;
  if (field.label) console.log(`  ${field.label}`);
  field.options?.forEach((option, i) => console.log(`  ${i + 1}) ${option.label}`));
  return field.options?.[Number(await prompt.question("  Number: ")) - 1]?.value;
}

// The module saves finding it from the page; "questionnaire" is the other survey module supported.
const survey = await moodle.getSurvey(SURVEY_ID, "feedback");
if (!survey.canAnswer) {
  console.log(`Survey: ${survey.messages.join(" ")}`);
} else {
  console.log(survey.intro);
  // Every page's questions, read ahead: responses go by form name, whatever page they're on.
  const responses: Record<string, string> = {};
  for (const question of survey.questions) {
    console.log(`\n${question.number ?? ""} ${question.text}${question.required ? " (required)" : ""}`);
    for (const field of question.fields) {
      const value = await ask(field);
      if (value !== undefined) responses[field.name] = value;
    }
  }
  try {
    // Fills each page with its responses and submits on the last one, as the person would.
    const { changed, messages } = await moodle.submitSurvey(SURVEY_ID, responses, { type: "feedback" });
    console.log(`${changed} ${messages.join(" ")}`);
  } catch (error) {
    // Moodle sent a page back (a required question unanswered): its messages are in the error.
    if (error instanceof SurveyError) console.log(`Not submitted: ${error.message}`);
    else throw error;
  }
}

const choice = await moodle.getChoice(CHOICE_ID);
console.log(`\n${choice.name}\n${choice.intro}`);
if (!choice.canAnswer) {
  console.log(`${choice.messages.join(" ")} Your answer: ${choice.answer.join(", ") || "none"}`);
} else {
  // Full options (a limit of answers reached) can't be chosen.
  const open = choice.options.filter((o) => !o.full);
  open.forEach((option, i) => console.log(`  ${i + 1}) ${option.text}${option.selected ? " *" : ""}`));
  const typed = await prompt.question(choice.multiple ? "Numbers, separated by commas: " : "Number: ");
  const ids = typed.split(",").flatMap((n) => open[Number(n) - 1]?.id ?? []);
  // In a multiple choice the options left out are unticked: ids is the whole answer.
  if (ids.length > 0) console.log((await moodle.answerChoice(CHOICE_ID, ids)).changed);
}
prompt.close();
```

## Step by step

1. `logIn()` opens a window the first time for the person to log in.
2. `getSurvey(SURVEY_ID, "feedback")` reads the activity's page and, when the person can answer (`canAnswer`), every page of its form. Each question has its `text`, whether it's `required`, and its `fields` by form name. When the person has answered already, or the survey is closed, `messages` says so.
3. The program asks for each field at the terminal and keeps the answers by field name. `submitSurvey` checks every name against the form first (a wrong one sends nothing), then fills the pages with their "Next page" button and submits on the last.
4. `getChoice(CHOICE_ID)` reads the choice's page: its options with their ids, whether several can be chosen (`multiple`), and the person's current answer (`selected`, `answer`).
5. `answerChoice(CHOICE_ID, ids)` saves the options as "Save my choice" does and returns `changed` and the choice afterwards.

## What it prints

An example; the texts are the activities'.

```text
Tell us how the first unit went.

1 How clear were the explanations? (required)
  1) Not at all
  2) Somewhat
  3) Very
  Number: 3

2 What would you change?
  > More exercises on recursion.
Submitted feedback 34. Thank you. Your answers have been saved.

Lab group
Choose the lab session you'll attend.
  1) Monday 10:00
  2) Wednesday 16:00 *
Number: 1
Answered choice 40: Monday 10:00.
```

## Variations

- A questionnaire (mod_questionnaire) instead: give `"questionnaire"` to both calls, or no type and let the driver find it at the cost of a page or two. Its rating grids come as one `choice` field per row.
- Prepared answers instead of the terminal: fill `responses` by field name (`await moodle.submitSurvey(34, { "multichoice_12": "3" })`), taking the names from `getSurvey` once.
- Check the answer without changing it: `(await moodle.getChoice(40)).answer` lists the chosen options by text, also once the choice is closed.

## When something goes wrong

- `SurveyError` from `getSurvey`: the id isn't an activity of that module the person can open; check its type in the course structure.
- `SurveyError` from `submitSurvey`: unknown field names (nothing is sent), the survey can't be answered now, or Moodle sent a page back with messages by field. After a server error (5xx) Moodle may or may not have saved the answers: read the survey again before retrying.
- `ChoiceError` from `getChoice` or `answerChoice`: not a choice the person can open, closed or not open yet, answered already where changes aren't allowed, several options in a single choice, or an option that's full. Nothing is saved.
- `NotLoggedInError`: the session expired while the person was typing. Call `moodle.logIn()` and run again. See [Errors](../concepts/errors.md).

## Data it touches

`getSurvey` and `getChoice` are `course-content` and `own`; `submitSurvey` and `answerChoice` are `own`. See [data categories](../concepts/data-categories.md).

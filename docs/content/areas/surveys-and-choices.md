# Surveys and choices

Answering surveys and choices as a student does: reading a survey's questions with their fields and filling it in page by page, and reading a choice's options and choosing one or several. Two survey modules are supported: Moodle's feedback (`feedback`) and the questionnaire plugin (`questionnaire`, mod_questionnaire). Moodle's older "survey" module (fixed instruments such as COLLES and ATTLS) isn't. These functions act as the person, on their own answers; teachers' views of the responses aren't covered.

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level pieces the operations are built from are functions only.

Everything is read from the activities' pages and forms (body ids, form names, labels), so it works in any interface language; the texts come in the site's language. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## getSurvey

Whether the person can answer a survey now, its description and messages, and, when they can, every question on every page of its form.

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

- `activityId`: the activity's id (course module id). `type`: its module, from the course structure; without it, the driver finds it from the page each module answers with (once per activity), at the cost of a page or two.
- `canAnswer`: the activity's page links to its form: it's open and the person hasn't answered yet (or may answer again).
- `intro`: the activity's description; `messages`: the page's notices ("You have already submitted", closed, not open yet).
- `questions`: empty when the person can't answer. Each question has the `page` it's on (from 0), its `number` and `text` as shown, whether it's `required`, and its `fields`.

A field is one input of the form, by its form name: that name is what `submitSurvey` takes.

- `choice`: radio buttons; give one of `options[].value`. In a questionnaire's rating grid each row is its own field, labelled by the row's item; its "no answer" option (value `-999`) is labelled `(no answer)`.
- `checkbox`: one per option; give `"1"` to tick it. `label` is the option's text.
- `select`: a drop-down; give one of `options[].value`.
- `text`: typed text (a short or long answer, a number).

`value` is the current value, when there is one. The form is read page by page (feedback pages through `gopage`, questionnaire sections through `sec`), up to 50 pages. Throws `SurveyError` when the id isn't an activity of that module the person can open.

## submitSurvey

Fills the survey page by page with the given responses and submits it on the last page, as the person would with its "Next page" and submit buttons.

```ts
function submitSurvey(context: BrowserContext, siteUrl: string, activityId: number, responses: Record<string, string>, options?: { type?: SurveyType }): Promise<{ changed: string; messages: string[] }>;
// As before 0.2, still accepted:
function submitSurvey(context: BrowserContext, siteUrl: string, activityId: number, type: SurveyType, responses: Record<string, string>): Promise<{ changed: string; messages: string[] }>;
```

- `responses`: values by field name, for any page: each page gets the ones its form has.
- Returns `changed` and the activity page's messages afterwards (usually that the person has submitted).

Without a `type`, the module is found as `getSurvey` finds it. Every name is checked against the whole form before anything is sent, so a wrong name sends nothing: `SurveyError` names the unknown fields. `SurveyError` also comes when the person can't answer now (with the page's messages), when Moodle sends a page back because something's missing or wrong (a required question unanswered: Moodle's messages are in the error, by field where it gives one), and when the site answers with a server error (5xx), in which case Moodle may or may not have recorded the answers: read the survey again before trying again. `submitSurvey` takes no `trail` option: the form is filled and sent at once, page after page.

## getChoice

A choice activity, read on its page: its options with the ids answers take, whether it can be answered or changed, and the person's answer. Moodle's choice services aren't open to AJAX calls, so the page is the source.

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

- `id`: the course module id given; `name` and `intro`: the activity's name and description.
- `options`: each option's id (what `answerChoice` takes), text, whether the person chose it, and whether it's `full` (a limit of answers reached, so it can't be chosen).
- `multiple`: the choice allows several options at once.
- `canAnswer`: the form is there: the choice is open and the person may answer, or change their answer.
- `canChange`: an answer given can be removed or changed.
- `answer`: the options chosen, by their text, also when the form is gone (a closed choice still shows the person's selection).
- `messages`: the page's notices (closed, not open yet, results not published...).

Throws `ChoiceError` when the id isn't a choice the person can open.

## answerChoice

Answers a choice with one option, or several where it allows them, by id, as "Save my choice" does; returns `changed` and the choice afterwards.

```ts
function answerChoice(context: BrowserContext, siteUrl: string, activityId: number, optionIds: number[]): Promise<{ changed: string; choice: Choice }>;
```

In a multiple choice, the options not given are unticked, so `optionIds` is the whole answer. Throws `ChoiceError`, before saving anything, when no option is given, when the choice can't be answered now (closed, not open yet, or answered and not allowing changes; the error repeats the person's answer and Moodle's message), when several are given to a single choice, when an option id isn't the choice's (the error lists its options), and when an option is full.

## Example

```ts
import { SurveyError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

// A feedback activity (course module 34): answer every required question.
const survey = await moodle.getSurvey(34);
if (survey.canAnswer) {
  const responses: Record<string, string> = {};
  for (const question of survey.questions) {
    const field = question.fields[0];
    if (!field || !question.required) continue;
    if (field.kind === "text") responses[field.name] = "Clear and well paced.";
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
  console.log(`Can't answer: ${survey.messages.join(" ")}`);
}

// A choice (course module 40): pick the option whose text is "while".
const choice = await moodle.getChoice(40);
const option = choice.options.find((o) => o.text === "while" && !o.full);
if (choice.canAnswer && option) {
  const { choice: after } = await moodle.answerChoice(40, [option.id]);
  console.log(`Answer: ${after.answer.join(", ")}`);
}
```

## Data categories

- `getSurvey`, `getChoice`: `course-content` and `own` (the activity and the person's answer).
- `submitSurvey`, `answerChoice`: `own`.
- The page readers `readSurveyPage` and `readChoice`: `none`.

See [Data categories](../concepts/data-categories.md).

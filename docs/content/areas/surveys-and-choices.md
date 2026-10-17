# Surveys and choices

Answering surveys and choices as a student does: reading a survey's questions with their fields and filling it in page by page, and reading a choice's options and choosing one or several. Two survey modules are supported: Moodle's feedback (`feedback`) and the questionnaire plugin (`questionnaire`, mod_questionnaire). Moodle's older "survey" module (fixed instruments such as COLLES and ATTLS) isn't. A teacher can also read what everyone answered: `surveyResults` for a survey and `choiceResults` for a choice, from the reports Moodle shows teachers; and build a feedback's questions: `feedbackItems`, `addFeedbackItem`, `editFeedbackItem`, `moveFeedbackItem`, `deleteFeedbackItem`, and its templates.

**Terms:** [survey](../reference/glossary.md#survey), [choice](../reference/glossary.md#choice), [feedback](../reference/glossary.md#feedback).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

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

## surveyResults

What people answered in a feedback or a questionnaire, as its reports show a teacher: every response, who gave it unless it's anonymous, and each question with every response's answer, how many chose each option and the average of numeric answers.

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

- `type`: the activity's module; without it, it's found as `getSurvey` finds it.
- `responses`: each response's id in Moodle (a feedback's completed response, a questionnaire's response), whether it was given anonymously, and otherwise who gave it. A feedback names people with their `userId` and `fullName`, and numbers its anonymous responses (`number`, its "Response number"); a questionnaire's report names people without linking them, so its responses carry the `fullName` only.
- `questions`: the questions that take answers, in the survey's order. `id` is a feedback's item id or a questionnaire's question id; `type` is the module's own (feedback: `multichoice`, `multichoicerated`, `numeric`, `textfield`, `textarea`…; questionnaire: `radio`, `check`, `drop`, `yesno`, `rate`, `text`, `essay`, `numeric`, `date`…).
- `answers`: each response's answer by its `responseId`: the option or options chosen, the text or the number given; a questionnaire's "other" text comes after the option and a colon, and a rate question's rows as `"row: option"`. Responses that left the question blank aren't listed.
- `counts`: for choice questions, every option the question offers, in order, with how many answers chose it (options nobody chose count 0), counted from the answers as Moodle's analysis counts them.
- `average`: for numeric questions, and a feedback's rated choices by their options' weights, the mean to two decimals.
- `rows`: a questionnaire's rate question, each row with its counts per column and its average rank (the columns' own numbers, or their positions when they're named).

A feedback is read from its print page (the questions and their options), its "Show responses" tables (who answered) and those tables' CSV downloads (every answer: the tables show ten questions at most); it takes `mod/feedback:viewreports`, which teachers have. A questionnaire is read from its report's individual responses, one page per response, in the order of its list of responses (in-progress responses too, as the list shows them); it takes `mod/questionnaire:readallresponses`, which teachers have and students too where the questionnaire lets them see all responses (its "Students can view ALL responses" setting). Throws `SurveyError` when Moodle refuses the report or a questionnaire's page doesn't link to it (as when nobody has answered it yet) (Moodle's message and the capability are in the error), when the id isn't a survey of that module, and when the questionnaire plugin isn't installed on the site.

## feedbackItems

A feedback's items as its teacher builds them on its "Questions" page, in order: the questions, the labels and information items, and the page breaks.

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

- `type`: Moodle's own names (`FEEDBACK_ITEM_TYPES`), as `surveyResults` gives them: multiple choice (`multichoice`), rated multiple choice (`multichoicerated`), short text answer (`textfield`), longer text answer (`textarea`), numeric answer (`numeric`), information (`info`), label (`label`), CAPTCHA (`captcha`) and page break (`pagebreak`).
- `id`: the item's id, the same `surveyResults` gives its question; `position`: its place, from 1.
- `question`: the question's text (empty for a label or a page break); `label`: Moodle's "Label" field, a short name for the item in reports and dependencies.
- `options`: a choice's options in order, a rated choice's with their `weight`; `display`: radio buttons, checkboxes (several answers, multiple choice only) or a drop-down list; `horizontal`, `hideNotSelected` (no "Not selected" option) and `ignoreEmpty` (empty answers left out of the analysis): the choice's other settings.
- `range`: a numeric item's range, where it has one; `info`: what an information item shows (the time of the response, the course or its category); `contents`: a label's HTML.
- `dependsOn`: the item is shown only when another one, by its id, was answered with `value`.

The items come from the feedback's export of its questions (`export.php`), which takes `mod/feedback:edititems` as building them does (editing teachers have it); throws `SurveyError` with Moodle's message without it, or when the id isn't a feedback. A feedback without items reads as none.

## addFeedbackItem

Adds an item to a feedback, as its "Add question" menu and the item's form do.

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

- `after`: the item it goes after (0 puts it first); by default it goes last.
- `question`: every type but a label and a page break needs one; a label takes `contents` (HTML).
- `options`: a choice's options, one line of text each (without `|`, Moodle's separator); a rated choice's as `{ text, weight }`, the weight a whole number (0 when left out).
- `required`: not for information items, labels and page breaks, which Moodle never makes required. `info: "response-time"` only where the feedback isn't anonymous, as Moodle offers it.
- `dependsOn`: shown only when another item that takes answers was answered with `value` (in Moodle, it goes on a later page than that item).
- `fields`: any other field of the item's form by name (a short text's `itemsize` and `itemmaxlength`, a long text's `itemwidth` and `itemheight`…).
- Returns the new item's id and the feedback's items in order.

A page break and a CAPTCHA have no form: Moodle adds them at the end when their link is opened, and the driver then moves them where `after` says. Moodle adds no page break to a feedback without items or right after another page break at the end, and one CAPTCHA at most (whose check works only with the site's reCAPTCHA keys). Throws `SurveyError`, before anything is saved, for a type the feedback's "Add question" menu doesn't offer, for what the type doesn't take (options on a text item, `required` on a label…), and for an `after` or a `dependsOn` item the feedback doesn't have; `FormError` with Moodle's messages by field when it refuses the form.

## editFeedbackItem

Changes an item through its form with what's given; the rest stays as it is.

```ts
function editFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number, changes: Partial<Omit<FeedbackItemInput, "type">>): Promise<{ changed: string; itemId: number }>;
```

Given `options` replace them all; `dependsOn: null` removes the dependency. An item keeps its type and its place (`moveFeedbackItem` moves it). A page break and a CAPTCHA have nothing to change: `SurveyError`, as for an item the feedback doesn't have, no changes, or what the type doesn't take.

## moveFeedbackItem

Moves an item to a position, from 1, as the "Questions" page's drag and drop does (Moodle's `mod_feedback_questions_reorder` service).

```ts
function moveFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number, position: number): Promise<{ changed: string; itemId: number; itemIds: number[] }>;
```

Returns the items in their new order. Throws `SurveyError` for an item the feedback doesn't have or a position outside 1 to the number of items.

## deleteFeedbackItem

Deletes an item, as the "Questions" page's delete action does once confirmed; the answers given to it go with it, as in Moodle.

```ts
function deleteFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number): Promise<{ changed: string; itemId: number; itemIds: number[] }>;
```

Returns the items left, in order; `SurveyError` for an item the feedback doesn't have.

## Feedback templates

A template keeps a feedback's items to use in another: the course's own templates, or public ones every course can use.

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

- `feedbackTemplates`: the templates the feedback can use, the course's first, as its "Templates" page lists them.
- `saveFeedbackTemplate`: the feedback's items as a new template, as "Save as new template" does: the course's own, or public with `public`, which takes `mod/feedback:createpublictemplate` in the whole site (managers). A course's own takes `mod/feedback:createprivatetemplate`, which editing teachers have.
- `useFeedbackTemplate`: the template's items added after the feedback's, as "Use this template" does; with `replace`, in their place. Moodle's own form starts with replacing them; here it's off unless asked, so nothing is lost unasked. Returns the items afterwards.
- `deleteFeedbackTemplate`: as the "Templates" page's delete does once confirmed; a public one takes `mod/feedback:createpublictemplate` and `mod/feedback:deletetemplate` in the whole site.

Saving and using go through Moodle's dynamic forms (the `core_form_dynamic_form` service), as their dialogs do. Each one throws `SurveyError` for a template the feedback can't use, for a feedback without items to save, and when Moodle refuses (the capability is in the error).

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

## choiceResults

A choice's responses, as its responses report shows them to a teacher: each option with how many chose it and who.

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

- `options`: in the choice's order, each with its id (what `answerChoice` takes), its text, its count and the people who chose it. The id comes from the report's "select all" checkboxes, which only those who can delete responses get (`mod/choice:deleteresponses`, as teachers can); without them it's missing.
- `notAnswered`: who hasn't answered, when the choice shows them (its "Show column for unanswered" setting), recognised by the same checkboxes.
- The report names people whatever the choice publishes: its "Publish results" setting is about what students see.

When nobody has answered, Moodle shows no table: the options come from the choice's page, each with a count of 0. Needs `mod/choice:readresponses`, which teachers have; throws `ChoiceError` with Moodle's message when it's refused or the id isn't a choice.

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

As a teacher, the same activities' results:

```ts
// `moodle` is the object from createMoodle(), as in the getting-started pages.

// Who answered the feedback (course module 34), and how many chose each option of each question.
const results = await moodle.surveyResults(34);
for (const response of results.responses) console.log(response.anonymous ? `Anonymous response ${response.number}` : response.fullName);
for (const question of results.questions) {
  const counts = question.counts?.map((c) => `${c.option}: ${c.count}`).join(", ");
  console.log(`${question.text}: ${counts ?? question.answers.map((a) => a.values.join(" / ")).join(" | ")}${question.average !== undefined ? ` (average ${question.average})` : ""}`);
}

// Who chose what in the choice (course module 40).
const { options } = await moodle.choiceResults(40);
for (const option of options) console.log(`${option.text} (${option.count}): ${option.users.map((u) => u.fullName).join(", ")}`);
```

As a teacher, building a feedback's questions and keeping them as a template:

```ts
// `moodle` is the object from createMoodle(), as in the getting started pages.

// A feedback (course module 34): a required choice, a rated one, then a second page with a text answer.
const help = await moodle.addFeedbackItem(34, { type: "multichoice", question: "Did the course help you?", required: true, options: ["Yes", "No"] });
await moodle.addFeedbackItem(34, { type: "multichoicerated", question: "The pace", options: [{ text: "Too slow", weight: 1 }, { text: "Right", weight: 3 }, { text: "Too fast", weight: 1 }] });
await moodle.addFeedbackItem(34, { type: "pagebreak" });
await moodle.addFeedbackItem(34, { type: "textarea", question: "What would you change?" });
// A welcome text first, and the first question reworded.
await moodle.addFeedbackItem(34, { type: "label", contents: "<p>Thanks for your time.</p>", after: 0 });
await moodle.editFeedbackItem(34, help.itemId, { question: "Did this course help you?" });
for (const item of await moodle.feedbackItems(34)) console.log(`${item.position}. ${item.type} ${item.question}`);

// Kept as a template of the course, then used in another feedback (course module 35).
const { templateId } = await moodle.saveFeedbackTemplate(34, "End of course");
await moodle.useFeedbackTemplate(35, templateId);
```

## Data categories

- `getSurvey`, `getChoice`: `course-content` and `own` (the activity and the person's answer).
- `submitSurvey`, `answerChoice`: `own`.
- `surveyResults`, `choiceResults`: `course-content`, `others-aggregate` and `others-personal` (the activity, its counts, and everyone's answers with their names).
- `feedbackItems`, `addFeedbackItem`, `editFeedbackItem`, `moveFeedbackItem`, `deleteFeedbackItem`, `feedbackTemplates`, `saveFeedbackTemplate`, `useFeedbackTemplate`, `deleteFeedbackTemplate`: `course-content`.

See [Data categories](../concepts/data-categories.md).

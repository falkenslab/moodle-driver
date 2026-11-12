import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import {
  SurveyError,
  addQuestionnaireQuestions,
  questionnaireQuestions,
} from "../../../src/index.js";
import {
  questionnaireFormValues,
  questionnaireQuestionOf,
} from "../../../src/areas/surveys/questionnaire.js";
import {
  SITE,
  launchTestBrowser,
  moodlePage,
  serveFakeMoodle,
} from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A question as the plugin keeps it: its type id and its form's fields. */
interface FakeQuestion {
  id: number;
  typeId: number;
  name: string;
  required: string;
  content: string;
  allchoices?: string;
  length?: string;
  precise?: string;
  allnameddegrees?: string;
}

const TYPE_IDS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 100];

/**
 * A made-up questionnaire (cmid 61) shaped like the plugin's 5.0.3 pages on Moodle 5.2, reduced: the
 * questions page (each question's buttons, a page break's edit button disabled, the type menu without
 * "Page Break" while empty, the "View all responses" tab once answered) and each question's form, new
 * or a question's own, which saves as the plugin does; the menu's "Add" adds a page break at once.
 */
function fakeQuestionnaire({
  questions = [] as FakeQuestion[],
  answered = false,
} = {}) {
  let nextId = 300;
  const saved: URLSearchParams[] = [];
  const v = (value: string | undefined) =>
    (value ?? "").replaceAll('"', "&quot;");
  const mainPage = () => {
    const types = [...(questions.length > 0 ? [99] : []), ...TYPE_IDS];
    const rows = questions
      .map(
        (q) =>
          `<div class="qn-container"><input type="image" name="movebutton[${q.id}]" value="${q.id}"><input type="image" name="editbutton[${q.id}]" ${q.typeId === 99 ? 'disabled="disabled"' : `value="${q.id}"`}>` +
          `<input type="image" name="removebutton[${q.id}]" value="${q.id}"></div>`,
      )
      .join("");
    return `<ul class="nav">${answered ? `<li><a class="nav-link" href="${SITE}mod/questionnaire/report.php?instance=6&amp;action=vall">View all responses</a></li>` : ""}</ul>
<form class="mform" method="post" action="${SITE}mod/questionnaire/questions.php"><input type="hidden" name="id" value="61"><input type="hidden" name="sid" value="6"><input type="hidden" name="action" value="main">
<input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__mod_questionnaire_questions_form" value="1">
<select name="type_id">${types.map((t) => `<option value="${t}">${t}</option>`).join("")}</select><input type="submit" name="addqbutton" value="Add selected question type">
<div class="qcontainer">${rows}</div><div class="qcontainer"><input type="image" name="restorebutton[5]" value="5"><input type="image" name="deletebutton[5]" value="5"></div></form>`;
  };
  /** The type's form, with a question's values when it has one. */
  const questionForm = (typeId: number, q: FakeQuestion | undefined) => {
    const fields: string[] = [];
    if (![11, 100].includes(typeId))
      fields.push(
        `<input type="radio" name="required" value="y"${q?.required === "y" ? " checked" : ""}><input type="radio" name="required" value="n"${q?.required !== "y" ? " checked" : ""}>`,
      );
    if (typeId === 4)
      fields.push(
        `<input type="hidden" name="precise" value="0"><input type="radio" name="length" value="0"${q?.length !== "1" ? " checked" : ""}><input type="radio" name="length" value="1"${q?.length === "1" ? " checked" : ""}>`,
      );
    else if (typeId === 3) {
      const select = (name: string, options: string[], value: string) =>
        `<select name="${name}">${options.map((o) => `<option value="${o}"${o === value ? " selected" : ""}>${o}</option>`).join("")}</select>`;
      fields.push(
        select("precise", ["0", "1"], q?.precise ?? "0"),
        select("length", ["5", "10", "15", "20"], q?.length ?? "20"),
      );
    } else if ([2, 5, 8, 10].includes(typeId))
      fields.push(
        `<input name="length" value="${v(q?.length ?? "0")}"><input name="precise" value="${v(q?.precise ?? "0")}">`,
      );
    else
      fields.push(
        `<input type="hidden" name="length" value="0"><input type="hidden" name="precise" value="0">`,
      );
    if ([4, 5, 6, 8].includes(typeId))
      fields.push(
        `<textarea name="allchoices">${q?.allchoices ?? ""}</textarea>`,
      );
    if (typeId === 8)
      fields.push(
        `<textarea name="allnameddegrees">${q?.allnameddegrees ?? ""}</textarea>`,
      );
    return `<form class="mform" method="post" action="${SITE}mod/questionnaire/questions.php"><input type="hidden" name="id" value="61"><input type="hidden" name="qid" value="${q?.id ?? 0}">
<input type="hidden" name="type_id" value="${typeId}"><input type="hidden" name="action" value="question"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__mod_questionnaire_edit_question_form" value="1">
<input name="name" value="${v(q?.name)}">${fields.join("")}<textarea name="content[text]">${q?.content ?? ""}</textarea>
<input type="submit" name="submitbutton" value="Save changes"><input type="submit" name="makecopy" value="Save as New Question"></form>`;
  };
  const routes = async (context: BrowserContext) => {
    await context.route(
      `${SITE}mod/questionnaire/questions.php**`,
      (route: Route) => {
        const html = (bodyId: string, body: string) =>
          route.fulfill({
            status: 200,
            contentType: "text/html",
            body: moodlePage({ userId: 3, bodyId, body }),
          });
        const q = new URL(route.request().url()).searchParams;
        if (route.request().method() === "POST") {
          const form = new URLSearchParams(route.request().postData() ?? "");
          saved.push(form);
          if (
            form.get("action") === "main" &&
            form.has("addqbutton") &&
            form.get("type_id") === "99"
          )
            questions.push({
              id: nextId++,
              typeId: 99,
              name: "",
              required: "n",
              content: "break",
            });
          if (form.get("action") === "question") {
            const get = (name: string) => form.get(name) ?? undefined;
            questions.push({
              id: nextId++,
              typeId: Number(form.get("type_id")),
              name: form.get("name") ?? "",
              required: form.get("required") ?? "n",
              content: form.get("content[text]") ?? "",
              allchoices: get("allchoices"),
              length: get("length"),
              precise: get("precise"),
              allnameddegrees: get("allnameddegrees"),
            });
          }
          return html("page-mod-questionnaire-questions", mainPage());
        }
        if (q.get("id") !== "61")
          return html(
            "page-mod-questionnaire-questions",
            `<div data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div>`,
          );
        if (q.get("action") === "question") {
          const question = questions.find((x) => x.id === Number(q.get("qid")));
          return html(
            "page-mod-questionnaire-questions",
            questionForm(
              question?.typeId ?? Number(q.get("type_id")),
              question,
            ),
          );
        }
        return html("page-mod-questionnaire-questions", mainPage());
      },
    );
  };
  return { routes, questions, saved };
}

async function open(
  fake: ReturnType<typeof fakeQuestionnaire>,
): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await fake.routes(context);
  return context;
}

const seeded = (): FakeQuestion[] => [
  {
    id: 1,
    typeId: 6,
    name: "age",
    required: "y",
    content: "<p>Age</p>",
    allchoices: "Under 30\nOver 30",
    length: "0",
    precise: "0",
  },
  { id: 2, typeId: 99, name: "", required: "n", content: "break" },
  {
    id: 3,
    typeId: 8,
    name: "rating",
    required: "n",
    content: "<p>Rate</p>",
    allchoices: "Contents\nActivities",
    length: "5",
    precise: "1",
    allnameddegrees: "1=Bad\n5=Great",
  },
];

describe(
  "questionnaire questions",
  { skip: !browser && "no system browser" },
  () => {
    it("reads the questions in order, their pages, choices and settings, from the questions page and their forms", async () => {
      const context = await open(fakeQuestionnaire({ questions: seeded() }));
      assert.deepEqual(await questionnaireQuestions(context, SITE, 61), [
        {
          id: 1,
          type: "drop",
          position: 1,
          page: 1,
          name: "age",
          question: "<p>Age</p>",
          required: true,
          choices: ["Under 30", "Over 30"],
        },
        {
          id: 2,
          type: "pagebreak",
          position: 2,
          page: 2,
          name: "",
          question: "",
          required: false,
        },
        {
          id: 3,
          type: "rate",
          position: 3,
          page: 2,
          name: "rating",
          question: "<p>Rate</p>",
          required: false,
          choices: ["Contents", "Activities"],
          scale: 5,
          rateKind: "na-column",
          namedDegrees: [
            { value: 1, text: "Bad" },
            { value: 5, text: "Great" },
          ],
        },
      ]);
      await assert.rejects(
        questionnaireQuestions(context, SITE, 62),
        /Moodle didn't show the questions of questionnaire 62 \(Moodle says: Invalid course module ID\)/,
      );
      await context.close();
    });

    it("adds questions and page breaks in order through their forms, and reads them back", async () => {
      const fake = fakeQuestionnaire();
      const context = await open(fake);
      const result = await addQuestionnaireQuestions(context, SITE, 61, [
        {
          type: "radio",
          question: "<p>Level</p>",
          name: "level",
          required: true,
          choices: ["Low", "High"],
          horizontal: true,
        },
        { type: "pagebreak" },
        { type: "essay", question: "<p>Why?</p>", lines: 10, editor: false },
        {
          type: "check",
          question: "<p>Used</p>",
          choices: ["Videos", "!other=Other:"],
          minChecked: 1,
          maxChecked: 2,
        },
      ]);
      assert.equal(result.changed, "Added 4 questions to questionnaire 61.");
      assert.deepEqual(result.questionIds, [300, 301, 302, 303]);
      assert.deepEqual(result.questions, [
        {
          id: 300,
          type: "radio",
          position: 1,
          page: 1,
          name: "level",
          question: "<p>Level</p>",
          required: true,
          choices: ["Low", "High"],
          horizontal: true,
        },
        {
          id: 301,
          type: "pagebreak",
          position: 2,
          page: 2,
          name: "",
          question: "",
          required: false,
        },
        {
          id: 302,
          type: "essay",
          position: 3,
          page: 2,
          name: "",
          question: "<p>Why?</p>",
          required: false,
          lines: 10,
          editor: false,
        },
        {
          id: 303,
          type: "check",
          position: 4,
          page: 2,
          name: "",
          question: "<p>Used</p>",
          required: false,
          choices: ["Videos", "!other=Other:"],
          minChecked: 1,
          maxChecked: 2,
        },
      ]);
      // The page break through the questions page's menu, the rest through their forms.
      assert.deepEqual(
        fake.saved.map(
          (form) => `${form.get("action")}:${form.get("type_id")}`,
        ),
        ["question:4", "main:99", "question:3", "question:5"],
      );
      await context.close();
    });

    it("checks everything before saving anything: types, settings, page breaks, the essay's lines", async () => {
      const fake = fakeQuestionnaire({ questions: seeded() });
      const context = await open(fake);
      const refused = async (
        questions: Parameters<typeof addQuestionnaireQuestions>[3],
        message: RegExp,
      ) =>
        assert.rejects(
          addQuestionnaireQuestions(context, SITE, 61, questions),
          (error: Error) =>
            error instanceof SurveyError && message.test(error.message),
        );
      await refused([], /Give the questions/);
      await refused(
        [{ type: "slider", question: "How much?" }],
        /doesn't add slider questions/,
      );
      await refused(
        [{ type: "text", question: "Town", choices: ["a"] }],
        /A text question takes no choices/,
      );
      await refused(
        [{ type: "radio", question: "Level" }],
        /needs its choices/,
      );
      await refused(
        [{ type: "label", question: "<p>Hi</p>", required: true }],
        /can't be required/,
      );
      await refused([{ type: "yesno" }], /needs its text/);
      await refused(
        [
          { type: "pagebreak" },
          { type: "pagebreak" },
          { type: "yesno", question: "Q" },
        ],
        /Question 2 is a page break right after another one/,
      );
      await refused(
        [{ type: "yesno", question: "Q" }, { type: "pagebreak" }],
        /page break: the plugin drops one at the end/,
      );
      await refused(
        [
          {
            type: "check",
            question: "Q",
            choices: ["a", "b"],
            minChecked: 2,
            maxChecked: 1,
          },
        ],
        /maxChecked \(1\) is under minChecked \(2\)/,
      );
      await refused(
        [{ type: "essay", question: "Q", lines: 7 }],
        /number of lines is one of 5, 10, 15, 20, not 7/,
      );
      assert.equal(fake.saved.length, 0);
      // A new questionnaire can't start with a page break.
      const empty = fakeQuestionnaire();
      const other = await open(empty);
      await assert.rejects(
        addQuestionnaireQuestions(other, SITE, 61, [
          { type: "pagebreak" },
          { type: "yesno", question: "Q" },
        ]),
        /Question 1 is a page break first/,
      );
      await other.close();
      await context.close();
    });

    it("refuses a questionnaire someone answered, unless asked to go on", async () => {
      const fake = fakeQuestionnaire({ questions: seeded(), answered: true });
      const context = await open(fake);
      await assert.rejects(
        addQuestionnaireQuestions(context, SITE, 61, [
          { type: "yesno", question: "<p>More?</p>" },
        ]),
        /has responses already/,
      );
      assert.equal(fake.saved.length, 0);
      const result = await addQuestionnaireQuestions(
        context,
        SITE,
        61,
        [{ type: "yesno", question: "<p>More?</p>" }],
        { evenWithResponses: true },
      );
      assert.deepEqual(result.questions.at(-1), {
        id: 300,
        type: "yesno",
        position: 4,
        page: 2,
        name: "",
        question: "<p>More?</p>",
        required: false,
      });
      await context.close();
    });
  },
);

describe("questionnaire question forms", () => {
  it("reads each type's settings from the plugin's length and precise fields", () => {
    const place = { position: 1, page: 1 };
    assert.deepEqual(
      questionnaireQuestionOf(
        9,
        {
          type_id: "2",
          name: "",
          required: "n",
          "content[text]": "Town",
          length: "30",
          precise: "60",
        },
        place,
      ),
      {
        id: 9,
        type: "text",
        ...place,
        name: "",
        question: "Town",
        required: false,
        width: 30,
        maxLength: 60,
      },
    );
    assert.deepEqual(
      questionnaireQuestionOf(
        9,
        {
          type_id: "10",
          required: "y",
          "content[text]": "Hours",
          length: "3",
          precise: "1",
        },
        place,
      ),
      {
        id: 9,
        type: "numeric",
        ...place,
        name: "",
        question: "Hours",
        required: true,
        maxDigits: 3,
        decimals: 1,
      },
    );
    assert.deepEqual(
      questionnaireQuestionOf(
        9,
        { type_id: "100", "content[text]": "<p>Hi</p>" },
        place,
      ),
      {
        id: 9,
        type: "label",
        ...place,
        name: "",
        question: "<p>Hi</p>",
        required: false,
      },
    );
    assert.throws(
      () => questionnaireQuestionOf(9, { type_id: "7" }, place),
      SurveyError,
    );
  });

  it("writes each type's settings in the plugin's fields", () => {
    assert.deepEqual(
      questionnaireFormValues(
        {
          type: "rate",
          question: "R",
          choices: ["A", "B"],
          scale: 4,
          rateKind: "osgood",
          namedDegrees: [{ value: 1, text: "Bad" }],
        },
        { precise: ["0", "1", "2", "3"] },
      ),
      {
        "content[text]": "R",
        required: "n",
        allchoices: "A\nB",
        length: "4",
        precise: "3",
        allnameddegrees: "1=Bad",
      },
    );
    assert.deepEqual(
      questionnaireFormValues(
        { type: "label", question: "<p>Hi</p>", fields: { extra: "1" } },
        {},
      ),
      { "content[text]": "<p>Hi</p>", extra: "1" },
    );
  });
});

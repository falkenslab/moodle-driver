// An offline quiz's questions (mod_offlinequiz: a quiz printed on paper, in groups A, B, C… each with
// its own questions) as its teacher builds them: each group's edit page (`edit.php?groupnumber=`,
// shaped like a quiz's: its slots and pages, its add menus empty once the forms exist), its bank
// action's post, and the forms page (`createquiz.php?mode=createpdfs`), which creates the question,
// answer and correction forms of every group the first time it's opened, as its button does.
import type { BrowserContext, Page } from "playwright-core";
import { QuizError } from "./attempts.js";
import { readQuizEditor, type QuizSlot } from "./structure.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";

/** A group of an offline quiz: its own questions, printed on its own forms. */
export interface OfflineQuizGroup {
  /** The group's number, from 1: what `addQuestionsToOfflineQuiz` takes as `group`. */
  number: number;
  /** Its letter on the forms: A for 1, B for 2… */
  letter: string;
  /** Its questions in order, each with its page, question, type, name and mark (as a quiz's slots). */
  slots: QuizSlot[];
  /** The sum of its questions' marks, as the edit page shows it. */
  totalMarks?: string;
}

/** An offline quiz's groups and whether its questions can still change. */
export interface OfflineQuizGroups {
  offlineQuiz: { id: number };
  /** The offline quiz's maximum grade, as its edit page shows it. */
  maxGrade?: string;
  /** Its forms exist (`createOfflineQuizForms`): the questions are fixed, as on paper. */
  formsCreated: boolean;
  /** Questions can be added: no forms yet, and no results. */
  editable: boolean;
  groups: OfflineQuizGroup[];
}

/** One group's forms: links to its PDF (or DOCX, LaTeX, as the offline quiz is set) files, for `downloadFile`. */
export interface OfflineQuizForms {
  group: string;
  questionForm?: string;
  answerForm?: string;
  correctionForm?: string;
}

const letter = (group: number) => String.fromCharCode(64 + group);

function editPath(activityId: number, group: number): string {
  return `mod/offlinequiz/edit.php?cmid=${activityId}&groupnumber=${group}`;
}

/** What a group's edit page tells: its groups, slots, marks, grade and whether it can change. */
interface EditPage {
  groupNumbers: number[];
  slots: QuizSlot[];
  totalMarks?: string;
  maxGrade?: string;
  formsCreated: boolean;
  editable: boolean;
  notice: string;
}

/** A group's edit page, or `QuizError` with Moodle's reason. */
async function openEditPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  group: number,
): Promise<Page> {
  const page = await openSitePage(
    context,
    siteUrl,
    editPath(activityId, group),
  );
  if (
    (await page.locator("body#page-mod-offlinequiz-edit").count()) === 0 ||
    (await moodleErrorMessage(page)) !== undefined
  ) {
    const reason = await moodleErrorMessage(page);
    await page.close().catch(() => undefined);
    throw new QuizError(
      `You can't edit offline quiz ${activityId}${reason ? ` (Moodle says: ${reason})` : ""}: it takes an offline quiz's id (module "offlinequiz") from the course structure, and the capability mod/offlinequiz:manage, which editing teachers have.`,
    );
  }
  return page;
}

/** The edit page's group menu, totals and lock, beside its slots (read as a quiz's). */
export async function readOfflineQuizEditor(page: Page): Promise<EditPage> {
  const { slots } = await readQuizEditor(page);
  const facts = await inPage(
    page,
    () => {
      interface El {
        value: string;
        textContent: string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const text = (el: El | null) =>
        (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        groupNumbers: Array.from(
          doc.querySelectorAll('select[name="groupnumber"] option'),
        )
          .map((o) => Number(o.value))
          .filter((n) => n > 0),
        totalMarks:
          text(doc.querySelector(".mod_offlinequiz_summarks")) || undefined,
        maxGrade: doc.querySelector("input#inputmaxgrade")?.value || undefined,
        // Once the forms exist, the status box links to them (confirmed empirically, offlinequiz v5.2.0, Moodle 5.2).
        formsCreated:
          doc.querySelectorAll(
            '.statusdisplay a[href*="/mod/offlinequiz/createquiz.php"]',
          ).length > 0,
        // As a quiz's edit page: empty add menus when its questions can't change.
        editable: doc.querySelectorAll(".add-menu-outer *").length > 0,
        notice: text(doc.querySelector(".statusdisplay")),
      };
    },
    null,
  );
  return {
    slots,
    ...facts,
    groupNumbers: facts.groupNumbers.length > 0 ? facts.groupNumbers : [1],
  };
}

const groupOf = (number: number, editor: EditPage): OfflineQuizGroup => ({
  number,
  letter: letter(number),
  slots: editor.slots,
  ...(editor.totalMarks ? { totalMarks: editor.totalMarks } : {}),
});

/**
 * An offline quiz's groups (A, B…) with their questions as each group's edit page lists them (slots
 * with their page, question, type, name and mark, as `quizStructure` reads a quiz's), its maximum
 * grade, and whether its forms exist and its questions can still change. Opening a group's edit page
 * makes the group in Moodle if it had none yet, as the plugin does for the number of groups it's set to.
 */
export async function offlineQuizGroups(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<OfflineQuizGroups> {
  const page = await openEditPage(context, siteUrl, activityId, 1);
  try {
    const first = await readOfflineQuizEditor(page);
    const groups = [groupOf(1, first)];
    for (const number of first.groupNumbers.filter((n) => n !== 1)) {
      await page.goto(new URL(editPath(activityId, number), siteUrl).href, {
        waitUntil: "domcontentloaded",
      });
      groups.push(groupOf(number, await readOfflineQuizEditor(page)));
    }
    return {
      offlineQuiz: { id: activityId },
      ...(first.maxGrade ? { maxGrade: first.maxGrade } : {}),
      formsCreated: first.formsCreated,
      editable: first.editable,
      groups,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Posts to a group's edit page as its bank dialog does; Moodle redirects back to it, or shows an error. */
async function postEditPage(
  page: Page,
  path: string,
  fields: Record<string, string>,
): Promise<{ status: number; error?: string }> {
  return page.evaluate(
    async ({ fields, path }) => {
      const g = globalThis as unknown as {
        M: { cfg: { wwwroot: string; sesskey: string } };
        fetch(
          url: string,
          init: object,
        ): Promise<{ status: number; text(): Promise<string> }>;
        URLSearchParams: new (init: Record<string, string>) => unknown;
        DOMParser: new () => {
          parseFromString(
            html: string,
            type: string,
          ): {
            querySelector(s: string): { textContent: string | null } | null;
          };
        };
      };
      const response = await g.fetch(`${g.M.cfg.wwwroot}/${path}`, {
        method: "POST",
        credentials: "same-origin",
        body: new g.URLSearchParams({ ...fields, sesskey: g.M.cfg.sesskey }),
      });
      const answer = new g.DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const error = (
        answer.querySelector('[data-rel="fatalerror"] .errormessage')
          ?.textContent ?? ""
      )
        .replace(/\s+/g, " ")
        .trim();
      return { status: response.status, ...(error ? { error } : {}) };
    },
    { fields, path },
  );
}

/**
 * Adds bank questions (by id) to a group of an offline quiz (`group`, from 1: A is 1), at its end or
 * on a page, as its edit page's "from question bank" action posts them. Returns the group afterwards.
 * Once the offline quiz's forms exist, or it has results, its questions can't change: the plugin
 * refuses, and so does this, with its notice.
 */
export async function addQuestionsToOfflineQuiz(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  {
    questionIds,
    group = 1,
    page: onPage,
  }: { questionIds: number[]; group?: number; page?: number },
): Promise<{
  changed: string;
  offlineQuiz: { id: number };
  group: OfflineQuizGroup;
}> {
  if (questionIds.length === 0)
    throw new QuizError("Give the ids of the bank questions to add.");
  if (!Number.isInteger(group) || group < 1)
    throw new QuizError(
      `A group is a number from 1 (group A): ${group} isn't one.`,
    );
  // Group A's page first: the plugin answers a group beyond its number of groups with an error page.
  const page = await openEditPage(context, siteUrl, activityId, 1);
  try {
    let before = await readOfflineQuizEditor(page);
    if (!before.groupNumbers.includes(group))
      throw new QuizError(
        `Offline quiz ${activityId} has groups ${before.groupNumbers.map(letter).join(", ")} (1 to ${before.groupNumbers.length}), not ${group}: its settings say how many.`,
      );
    if (group !== 1) {
      await page.goto(new URL(editPath(activityId, group), siteUrl).href, {
        waitUntil: "domcontentloaded",
      });
      before = await readOfflineQuizEditor(page);
    }
    if (!before.editable) {
      throw new QuizError(
        `Offline quiz ${activityId} can't change its questions now: ${before.notice || "its forms exist already"}. Delete its forms in Moodle (when nothing was scanned), or make a new offline quiz.`,
      );
    }
    const fields = {
      add: "1",
      addonpage: String(onPage ?? 0),
      ...Object.fromEntries(questionIds.map((id) => [`q${id}`, "1"])),
    };
    const { status, error } = await postEditPage(
      page,
      editPath(activityId, group),
      fields,
    );
    if (error || status >= 400)
      throw new QuizError(
        `Moodle didn't add the questions to offline quiz ${activityId}: ${error ?? `HTTP ${status}`}. Check the questions' ids (from the bank).`,
      );
    await page.reload({ waitUntil: "domcontentloaded" });
    const after = await readOfflineQuizEditor(page);
    const added = after.slots.length - before.slots.length;
    if (added <= 0)
      throw new QuizError(
        `Moodle added no question to group ${letter(group)} of offline quiz ${activityId}: check the questions' ids (from the bank), and that they aren't in the group already.`,
      );
    return {
      changed: `Added ${added} question${added === 1 ? "" : "s"} to group ${letter(group)} of offline quiz ${activityId}.`,
      offlineQuiz: { id: activityId },
      group: groupOf(group, after),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The forms page's three boxes (question forms, answer forms, correction forms), each with a link per group, in the groups' order. */
export function readOfflineQuizForms(
  page: Page,
): Promise<{ boxes: string[][]; notices: string[] }> {
  return page.evaluate(() => {
    interface El {
      href: string;
      textContent: string | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const boxes = Array.from(doc.querySelectorAll(".docsbox")).map((box) =>
      Array.from(
        box.querySelectorAll(
          'a[href*="/pluginfile.php/"][href*="/mod_offlinequiz/"]',
        ),
      ).map((a) => a.href),
    );
    const notices = Array.from(doc.querySelectorAll("#region-main .alert"))
      .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return { boxes, notices };
  });
}

/**
 * Creates an offline quiz's forms, as its "Create forms" button does: for every group, the question
 * form, the answer form people fill in and the correction form, in the format the offline quiz is set
 * to (PDF by default). From then on its questions are fixed (the plugin's rule: the forms are
 * printed). Every group needs questions first: the plugin creates none otherwise, and this throws its
 * notices. When the forms exist already, it gives them as they are. Returns each group's links, which
 * `downloadFile` saves.
 */
export async function createOfflineQuizForms(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<{
  changed: string;
  offlineQuiz: { id: number };
  forms: OfflineQuizForms[];
}> {
  const edit = await openEditPage(context, siteUrl, activityId, 1);
  let existed: boolean;
  try {
    existed = (await readOfflineQuizEditor(edit)).formsCreated;
  } finally {
    await edit.close().catch(() => undefined);
  }
  const page = await openSitePage(
    context,
    siteUrl,
    `mod/offlinequiz/createquiz.php?id=${activityId}&mode=createpdfs`,
  );
  try {
    if (
      (await page.locator("body#page-mod-offlinequiz-createquiz").count()) ===
        0 ||
      (await moodleErrorMessage(page)) !== undefined
    ) {
      const reason = await moodleErrorMessage(page);
      throw new QuizError(
        `Moodle didn't create the forms of offline quiz ${activityId}${reason ? ` (Moodle says: ${reason})` : ""}: it takes the capability mod/offlinequiz:createofflinequiz, which editing teachers have.`,
      );
    }
    const { boxes, notices } = await readOfflineQuizForms(page);
    if (boxes.length === 0 || boxes.every((links) => links.length === 0)) {
      throw new QuizError(
        `Moodle created no forms for offline quiz ${activityId}: ${notices.join(" ") || "its page shows none"}. Every group needs its questions first.`,
      );
    }
    const [questions = [], answers = [], corrections = []] = boxes;
    const count = Math.max(
      questions.length,
      answers.length,
      corrections.length,
    );
    const forms: OfflineQuizForms[] = Array.from({ length: count }, (_, i) => ({
      group: letter(i + 1),
      ...(questions[i] ? { questionForm: questions[i] } : {}),
      ...(answers[i] ? { answerForm: answers[i] } : {}),
      ...(corrections[i] ? { correctionForm: corrections[i] } : {}),
    }));
    return {
      changed: existed
        ? `Offline quiz ${activityId} had its forms already.`
        : `Created the forms of offline quiz ${activityId}, for group${count === 1 ? "" : "s"} ${forms.map((f) => f.group).join(", ")}.`,
      offlineQuiz: { id: activityId },
      forms,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

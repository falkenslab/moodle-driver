// Boards (mod_board) against the sandbox: a board made by the teacher on the scratch course, its three
// default "Heading" columns replaced, a column added, renamed, locked and removed; a note the student
// posts through the board's own form, counted, and its column not removed without being asked.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { BoardError, NotABoardError, type Moodle } from "../../src/index.js";
import { inPage, openSitePage } from "../../src/internals.js";
import { SITE, as, scratchCourse, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const SETUP = { timeout: 1_800_000 };

/** Posts a note to a column as `who`, through the plugin's note form (note_create_ajax.php), as the board's "+" does. */
async function postNote(who: Moodle, activityId: number, columnId: number, heading: string): Promise<void> {
  const page = await openSitePage(await who.context(), SITE, `mod/board/view.php?id=${activityId}`);
  try {
    // Through inPage: the helper below is a named function, which tsx wraps in __name.
    const status = await inPage(
      page,
      async ({ url, heading }) => {
        const g = globalThis as unknown as {
          fetch(url: string, init: object): Promise<{ json(): Promise<{ data?: { status: string; html?: string } }> }>;
          DOMParser: new () => { parseFromString(html: string, type: string): { querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null }> } };
        };
        const post = async (body: string) =>
          (await (await g.fetch(url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, credentials: "same-origin" })).json()).data;
        const shown = await post("");
        const doc = new g.DOMParser().parseFromString(shown?.html ?? "", "text/html");
        const fields = new URLSearchParams();
        for (const input of Array.from(doc.querySelectorAll('input[type="hidden"]'))) fields.set(input.getAttribute("name") ?? "", input.getAttribute("value") ?? "");
        fields.set("heading", heading);
        fields.set("content", "A note from the driver's suite.");
        fields.set("mediatype", "0");
        return (await post(fields.toString()))?.status;
      },
      { url: new URL(`mod/board/note_create_ajax.php?columnid=${columnId}&ownerid=0&groupid=0`, SITE).href, heading },
    );
    assert.equal(status, "submitted");
  } finally {
    await page.close();
  }
}

describe("boards", () => {
  let course: ScratchCourse;
  let boardId: number;
  let pageActivityId: number;
  let ideasId: number;

  before(async () => {
    course = await scratchCourse("boards");
    const teacher = await as("teacher");
    boardId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "board", name: "Driver check board", visibility: "shown" })).activityId!;
    pageActivityId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check page", content: "<p>x</p>", visibility: "shown" })).activityId!;
  }, SETUP);

  it("boardColumns: a new board's three default columns, unlocked, with no notes and the site's colours; another module refused", SLOW, async () => {
    const columns = await (await as("teacher")).boardColumns(boardId);
    assert.equal(columns.length, 3);
    assert.ok(columns.every((c) => c.name === "Heading" && !c.locked && c.notes === 0 && /^#[0-9A-Fa-f]{3,6}$/.test(c.colour)), JSON.stringify(columns));
    await assert.rejects((await as("teacher")).boardColumns(pageActivityId), NotABoardError);
  });

  it("setBoardColumns: the three renamed in place and a fourth added locked; the student can't", SLOW, async () => {
    const teacher = await as("teacher");
    const before = await teacher.boardColumns(boardId);
    const set = await teacher.setBoardColumns(boardId, ["To do", "Doing", "Done", { name: "Parked", locked: true }]);
    assert.deepEqual(set.columns.map((c) => [c.name, c.locked]), [["To do", false], ["Doing", false], ["Done", false], ["Parked", true]]);
    assert.deepEqual(set.columns.slice(0, 3).map((c) => c.id), before.map((c) => c.id));
    assert.deepEqual((await teacher.boardColumns(boardId)).map((c) => c.name), ["To do", "Doing", "Done", "Parked"]);
    await assert.rejects((await as("student")).setBoardColumns(boardId, ["Mine"]), BoardError);
  });

  it("addBoardColumn: a column added at the end", SLOW, async () => {
    const added = await (await as("teacher")).addBoardColumn(boardId, { name: "Ideas" });
    assert.equal(added.columns.at(-1)?.id, added.columnId);
    assert.equal(added.columns.at(-1)?.name, "Ideas");
    ideasId = added.columnId;
  });

  it("editBoardColumn: a column renamed (an ampersand in it), locked and unlocked; another id refused", SLOW, async () => {
    const teacher = await as("teacher");
    const added = { columnId: ideasId };
    const renamed = await teacher.editBoardColumn(boardId, added.columnId, { name: "Ideas & questions", locked: true });
    assert.deepEqual(renamed.columns.find((c) => c.id === added.columnId), { ...renamed.columns.find((c) => c.id === added.columnId)!, name: "Ideas & questions", locked: true });
    const unlocked = await teacher.editBoardColumn(boardId, added.columnId, { locked: false });
    assert.equal(unlocked.columns.find((c) => c.id === added.columnId)?.locked, false);
    await assert.rejects(teacher.editBoardColumn(boardId, 999_999_999, { name: "Nowhere" }), BoardError);
    await teacher.removeBoardColumn(boardId, added.columnId);
  });

  it("removeBoardColumn: a column with the student's note refused unless deleteNotes; one without removed", SLOW, async () => {
    const teacher = await as("teacher");
    const columns = await teacher.boardColumns(boardId);
    const done = columns.find((c) => c.name === "Done")!;
    const parked = columns.find((c) => c.name === "Parked")!;
    await postNote(await as("student"), boardId, done.id, "Driver check note");
    const counted = await teacher.boardColumns(boardId);
    assert.equal(counted.find((c) => c.id === done.id)?.notes, 1);
    assert.equal((await (await as("student")).boardColumns(boardId)).find((c) => c.id === done.id)?.notes, 1);
    await assert.rejects(teacher.removeBoardColumn(boardId, done.id), (error: Error) => error instanceof BoardError && error.message.includes("deleteNotes"));
    await assert.rejects(teacher.setBoardColumns(boardId, ["To do", "Doing"]), BoardError);
    assert.equal((await teacher.boardColumns(boardId)).length, 4);
    const removed = await teacher.removeBoardColumn(boardId, parked.id);
    assert.deepEqual(removed.columns.map((c) => c.name), ["To do", "Doing", "Done"]);
    const forced = await teacher.removeBoardColumn(boardId, done.id, { deleteNotes: true });
    assert.deepEqual(forced.columns.map((c) => c.name), ["To do", "Doing"]);
  });
});

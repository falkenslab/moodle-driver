import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { BoardError, MoodleError, NotABoardError, NotLoggedInError, addBoardColumn, boardColumns, editBoardColumn, removeBoardColumn, setBoardColumns } from "../../../src/index.js";
import { readBoardPage } from "../../../src/areas/boards/boards.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
import { newBoard, serveBoard, type FakeBoard } from "./fakeBoard.js";

const browser = await launchTestBrowser();
after(async () => {
  await browser?.close();
});

async function site(overrides: Partial<FakeBoard> = {}) {
  const context = await browser!.newContext();
  const b = newBoard(overrides);
  const state = await serveBoard(context, b);
  return { context, b, state };
}

const STUDENT = { id: 5, teacher: false };

describe("readBoardPage", () => {
  it("reads the arguments of the board's script and the owners offered", () => {
    const html = `<select name="ownerid"><option value="">Choose...</option><option value="5">A</option><option value="6">B</option></select><script>require(['mod_board/main'], function(amd) {amd.initialize("7", 5, 0); M.util.js_complete('mod_board/main');});</script>`;
    assert.deepEqual(readBoardPage(html), { boardId: 7, ownerId: 5, groupId: 0, owners: [5, 6] });
    assert.deepEqual(readBoardPage("<p>Please select a user</p>"), { ownerId: 0, groupId: 0, owners: [] });
  });
});

describe("boardColumns", { skip: !browser }, () => {
  it("reads the columns in order, with the site's colour by id, locked and their notes", async () => {
    const { context } = await site({ columns: [{ id: 21, name: "To do", locked: false }, { id: 22, name: "Done", locked: true }], notes: [{ columnId: 21, ownerId: 5, groupId: 0 }, { columnId: 21, ownerId: 6, groupId: 0 }] });
    try {
      assert.deepEqual(await boardColumns(context, SITE, 40), [
        { id: 21, name: "To do", colour: "#1B998B", locked: false, notes: 2 },
        { id: 22, name: "Done", colour: "#2D3047", locked: true, notes: 0 },
      ]);
    } finally {
      await context.close();
    }
  });

  it("counts every group's notes for a manager, a group's with groupId", async () => {
    const { context, state } = await site({ notes: [{ columnId: 21, ownerId: 5, groupId: 1 }, { columnId: 21, ownerId: 6, groupId: 2 }] });
    try {
      assert.equal((await boardColumns(context, SITE, 40))[0]?.notes, 2);
      assert.equal((await boardColumns(context, SITE, 40, { groupId: 2 }))[0]?.notes, 1);
      assert.ok(state.serviceCalls?.some((c) => c.methodname === "mod_board_get_board" && c.args.groupid === 2));
    } finally {
      await context.close();
    }
  });

  it("adds every owner's notes on a single-user board for a manager who isn't a participant, one owner's with ownerId", async () => {
    const { context } = await site({ singleUserMode: 2, owners: [5, 6], notes: [{ columnId: 22, ownerId: 5, groupId: 0 }, { columnId: 22, ownerId: 6, groupId: 0 }, { columnId: 22, ownerId: 6, groupId: 0 }] });
    try {
      assert.deepEqual((await boardColumns(context, SITE, 40)).map((c) => c.notes), [0, 3, 0]);
      assert.deepEqual((await boardColumns(context, SITE, 40, { ownerId: 6 })).map((c) => c.notes), [0, 2, 0]);
    } finally {
      await context.close();
    }
  });

  it("refuses another activity, and a single-user board with nobody to show", async () => {
    const { context } = await site({ singleUserMode: 1, owners: [] });
    try {
      await assert.rejects(boardColumns(context, SITE, 41), NotABoardError);
      await assert.rejects(boardColumns(context, SITE, 40), (error: Error) => error instanceof BoardError && error.message.includes("ownerId"));
    } finally {
      await context.close();
    }
  });

  it("asks to log in without a session", async () => {
    const context = await browser!.newContext();
    try {
      const b = newBoard();
      const state = await serveBoard(context, b);
      delete state.user;
      await assert.rejects(boardColumns(context, SITE, 40), NotLoggedInError);
    } finally {
      await context.close();
    }
  });
});

describe("board column writes", { skip: !browser }, () => {
  it("setBoardColumns: renames in place, adds the missing ones at the end (locked when asked), with the form's hidden fields", async () => {
    const { context, b } = await site();
    try {
      const result = await setBoardColumns(context, SITE, 40, ["To do", "Doing", "Done", { name: "Parked", locked: true }]);
      assert.deepEqual(result.columns.map((c) => [c.id, c.name, c.locked]), [[21, "To do", false], [22, "Doing", false], [23, "Done", false], [100, "Parked", true]]);
      assert.match(result.changed, /"To do", "Doing", "Done", "Parked" \(locked\).*were "Heading"/);
      const update = b.posts.find((p) => p.path === "/mod/board/column_update_ajax.php")!.form;
      assert.equal(update.get("_qf__mod_board_local_form_column_update"), "1");
      assert.equal(update.get("sesskey"), "s1");
      assert.equal(update.get("id"), "21");
      const create = b.posts.find((p) => p.path === "/mod/board/column_create_ajax.php")!.form;
      assert.equal(create.get("boardid"), "7");
      assert.equal(create.get("name"), "Parked");
    } finally {
      await context.close();
    }
  });

  it("setBoardColumns: removes the extra ones from the end, refused before any change when one has notes, unless deleteNotes", async () => {
    const { context, b } = await site({ notes: [{ columnId: 23, ownerId: 5, groupId: 0 }] });
    try {
      await assert.rejects(setBoardColumns(context, SITE, 40, ["One"]), (error: Error) => error instanceof BoardError && error.message.includes("column 23"));
      assert.deepEqual(b.columns.map((c) => c.name), ["Heading", "Heading", "Heading"]);
      assert.deepEqual(b.posts, []);
      const result = await setBoardColumns(context, SITE, 40, ["One"], { deleteNotes: true });
      assert.deepEqual(result.columns.map((c) => [c.id, c.name]), [[21, "One"]]);
      assert.deepEqual(b.notes, []);
    } finally {
      await context.close();
    }
  });

  it("setBoardColumns: refuses no columns, an empty or too long name, and a person who doesn't manage the board", async () => {
    const { context } = await site({ user: STUDENT });
    try {
      await assert.rejects(setBoardColumns(context, SITE, 40, []), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
      await assert.rejects(setBoardColumns(context, SITE, 40, [" "]), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
      await assert.rejects(setBoardColumns(context, SITE, 40, ["x".repeat(101)]), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
      await assert.rejects(setBoardColumns(context, SITE, 40, ["Mine"]), (error: Error) => error instanceof BoardError && error.message.includes("mod/board:manageboard"));
    } finally {
      await context.close();
    }
  });

  it("addBoardColumn: adds it at the end and gives its id", async () => {
    const { context } = await site();
    try {
      const result = await addBoardColumn(context, SITE, 40, { name: "Ideas & questions", locked: true });
      assert.equal(result.columnId, 100);
      assert.deepEqual(result.columns.at(-1), { id: 100, name: "Ideas & questions", colour: "#2D3047", locked: true, notes: 0 });
    } finally {
      await context.close();
    }
  });

  it("editBoardColumn: renames, locks and unlocks; another board's column refused", async () => {
    const { context, b } = await site();
    try {
      const renamed = await editBoardColumn(context, SITE, 40, 22, { name: "Doing", locked: true });
      assert.deepEqual(renamed.columns[1], { id: 22, name: "Doing", colour: "#2D3047", locked: true, notes: 0 });
      assert.match(renamed.changed, /renamed "Heading" to "Doing", locked/);
      await editBoardColumn(context, SITE, 40, 22, { locked: false });
      assert.equal(b.columns[1]?.locked, false);
      assert.match((await editBoardColumn(context, SITE, 40, 22, { name: "Doing" })).changed, /already as asked/);
      await assert.rejects(editBoardColumn(context, SITE, 40, 99, { name: "x" }), (error: Error) => error instanceof BoardError && error.message.includes("21, 22, 23"));
      await assert.rejects(editBoardColumn(context, SITE, 40, 22, {}), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    } finally {
      await context.close();
    }
  });

  it("removeBoardColumn: a column with notes refused unless deleteNotes; one without removed", async () => {
    const { context, b } = await site({ notes: [{ columnId: 21, ownerId: 5, groupId: 0 }] });
    try {
      await assert.rejects(removeBoardColumn(context, SITE, 40, 21), (error: Error) => error instanceof BoardError && error.message.includes("1 note") && error.message.includes("deleteNotes"));
      assert.equal(b.columns.length, 3);
      assert.deepEqual((await removeBoardColumn(context, SITE, 40, 23)).columns.map((c) => c.id), [21, 22]);
      const forced = await removeBoardColumn(context, SITE, 40, 21, { deleteNotes: true });
      assert.match(forced.changed, /with its 1 note/);
      assert.deepEqual(forced.columns.map((c) => c.id), [22]);
    } finally {
      await context.close();
    }
  });
});

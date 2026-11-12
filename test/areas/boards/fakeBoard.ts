// A made-up board activity (mod_board 1.405), as its view (view.php) starts its script, its column forms
// (column_create_ajax.php, column_update_ajax.php) answer JSON, and its services read, lock and delete
// columns, keeping what is posted as the plugin keeps it.
import type { BrowserContext, Route } from "playwright-core";
import { SITE, moodlePage, serveFakeMoodle, ServiceFailure, type FakeMoodleState } from "../../../src/testing/index.js";

export interface FakeColumn {
  id: number;
  name: string;
  locked: boolean;
}

export interface FakeNote {
  columnId: number;
  ownerId: number;
  groupId: number;
}

export interface FakeBoard {
  cmid: number;
  /** The board's instance id. */
  boardId: number;
  /** 0: one board for everyone; 1 and 2: one per participant (private, public). */
  singleUserMode: 0 | 1 | 2;
  /** The participants a single-user board offers its managers. */
  owners: number[];
  columns: FakeColumn[];
  notes: FakeNote[];
  colours: string[];
  /** The person: a teacher manages the board. */
  user: { id: number; teacher: boolean };
  /** Every form post received, by path. */
  posts: { path: string; form: URLSearchParams }[];
}

export function newBoard(overrides: Partial<FakeBoard> = {}): FakeBoard {
  return {
    cmid: 40,
    boardId: 7,
    singleUserMode: 0,
    owners: [],
    columns: [
      { id: 21, name: "Heading", locked: false },
      { id: 22, name: "Heading", locked: false },
      { id: 23, name: "Heading", locked: false },
    ],
    notes: [],
    colours: ["1B998B", "2D3047", "FFFD82"],
    user: { id: 2, teacher: true },
    posts: [],
    ...overrides,
  };
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function viewPage(b: FakeBoard, q: URLSearchParams): string {
  const page = (body: string) => moodlePage({ userId: b.user.id, body, bodyId: "page-mod-board-view", bodyClass: `path-mod-board cmid-${b.cmid}` });
  if (Number(q.get("id")) !== b.cmid) {
    return page('<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">Invalid course module ID</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/moodle/invalidcoursemodule">More information about this error</a></p></div>');
  }
  let ownerId = Number(q.get("ownerid") ?? 0);
  // A teacher isn't a participant here: a single-user board opens on nobody for them, unless chosen.
  if (b.singleUserMode !== 0 && !ownerId && !b.user.teacher) ownerId = b.user.id;
  const select = b.singleUserMode !== 0 && b.user.teacher ? `<form><select name="ownerid" class="custom-select singleselect">${ownerId ? "" : '<option value="">Choose...</option>'}${b.owners.map((id) => `<option value="${id}">User ${id}</option>`).join("")}</select></form>` : "";
  const start = b.singleUserMode === 0 || ownerId ? `<script>M.util.js_pending('mod_board/main'); require(['mod_board/main'], function(amd) {amd.initialize("${b.boardId}", ${ownerId}, 0); M.util.js_complete('mod_board/main');});</script>` : '<div class="alert">Please select a user</div>';
  return page(`${select}<div class="mod_board_wrapper"><div class="mod_board flex-fill"></div></div>${start}`);
}

/** The plugin's answer to a form script: the form rendered (its hidden fields, a field's error) or saved. */
function formAnswer(fields: Record<string, string>, error?: string): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input name="${name}" type="hidden" value="${escape(value)}" />`)
    .join("");
  const html = `<form autocomplete="off" action="#" method="post" class="mform">${hidden}<input type="text" class="form-control" name="name" id="id_name" value="">${error ? `<div class="form-control-feedback invalid-feedback" id="id_error_name">${error}</div>` : ""}</form>`;
  return JSON.stringify({ data: { status: "render", html, javascript: "", dialogtitle: "Column" } });
}

/** Serves `b` in `context` as a Moodle 5.2 site with mod_board would. */
export async function serveBoard(context: BrowserContext, b: FakeBoard): Promise<FakeMoodleState> {
  const board = (id: unknown) => {
    if (Number(id) !== b.boardId) throw new ServiceFailure("invalidrecord");
  };
  const column = (id: unknown) => b.columns.find((c) => c.id === Number(id));
  const manage = () => {
    if (!b.user.teacher) throw new ServiceFailure("nopermissions");
  };
  const state: FakeMoodleState = {
    user: { id: b.user.id, fullName: "Person" },
    pagesServed: [],
    serviceCalls: [],
    services: {
      mod_board_get_configuration: ({ id }) => {
        board(id);
        return { settings: JSON.stringify({ board: { id: String(b.boardId), singleusermode: String(b.singleUserMode) }, isEditor: b.user.teacher, colours: b.colours }), warnings: [] };
      },
      mod_board_get_board: ({ id, ownerid, groupid }) => {
        board(id);
        if (b.singleUserMode !== 0 && !ownerid) return [];
        // The plugin escapes the names (format_plain_text).
        return b.columns.map((c) => ({
          ...c,
          name: escape(c.name),
          notes: b.notes
            .filter((n) => n.columnId === c.id && (b.singleUserMode === 0 || n.ownerId === ownerid) && (!groupid || n.groupId === groupid))
            .map((n, i) => ({ id: c.id * 100 + i, userid: n.ownerId, heading: "Note", content: "", type: 0, info: "", url: "", timecreated: 0, rating: 0, sortorder: i, commentcount: 0 })),
        }));
      },
      mod_board_lock_column: ({ id, status }) => {
        const c = column(id);
        if (!c) return { status: false, historyid: 0 };
        manage();
        c.locked = Boolean(status);
        return { status: true, historyid: 1 };
      },
      mod_board_delete_column: ({ id }) => {
        const c = column(id);
        if (!c) return { status: true, historyid: 0 };
        manage();
        b.columns = b.columns.filter((other) => other !== c);
        b.notes = b.notes.filter((n) => n.columnId !== c.id);
        return { status: true, historyid: 1 };
      },
    },
  };
  await serveFakeMoodle(context, state);
  let nextId = 100;
  await context.route(`${SITE}mod/board/*.php**`, (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const q = url.searchParams;
    // Logged out, Moodle's login page, as the fake serves it.
    if (!state.user) return route.fallback();
    state.pagesServed?.push(url.pathname);
    if (url.pathname === "/mod/board/view.php") return route.fulfill({ status: 200, contentType: "text/html", body: viewPage(b, q) });
    const json = (body: string) => route.fulfill({ status: 200, contentType: "application/json", body });
    const form = new URLSearchParams(request.postData() ?? "");
    if (form.size > 0) b.posts.push({ path: url.pathname, form });
    if (!b.user.teacher) return json(JSON.stringify({ error: "Sorry, but you do not currently have permissions to do that (Manage board).", errorcode: "nopermissions" }));
    const create = url.pathname === "/mod/board/column_create_ajax.php";
    const target = create ? undefined : column(q.get("id"));
    if (create ? Number(q.get("boardid")) !== b.boardId : !target) return json(JSON.stringify({ error: "Can't find data record in database.", errorcode: "invalidrecord" }));
    const fields: Record<string, string> = create ? { boardid: String(b.boardId) } : { id: String(target!.id) };
    Object.assign(fields, { sesskey: "s1", [`_qf__mod_board_local_form_column_${create ? "create" : "update"}`]: "1" });
    if (form.size === 0) return json(formAnswer(fields));
    if (form.get("sesskey") !== "s1") return json(JSON.stringify({ error: "Your session has most likely timed out.", errorcode: "invalidsesskey" }));
    const name = form.get("name") ?? "";
    if (name.trim() === "") return json(formAnswer(fields, "Required"));
    if (create) b.columns.push({ id: nextId++, name, locked: false });
    else target!.name = name;
    return json(JSON.stringify({ data: { status: "submitted", redirecturl: `${SITE}mod/board/view.php?id=${b.cmid}`, callbackdata: { name } } }));
  });
  return state;
}

// The pieces of a fake workshop the submission, example and evaluation tests share: pages as Moodle
// 5.2 renders them, reduced to what the driver reads, and the file manager's draft area.
import type { BrowserContext, Route } from "playwright-core";
import { SITE, moodlePage } from "../../../src/testing/index.js";

/** Answers with a Moodle page of `bodyId` (`page-mod-workshop-…`) in the workshop's course module 58. */
export const html = (route: Route, body: string, bodyId: string, userId = 5) =>
  route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: moodlePage({ userId, body: `<div id="region-main"><div role="main">${body}</div></div>`, bodyId, bodyClass: "course-3 cmid-58" }) });

/** Moodle's error page, as `$OUTPUT->fatal_error` renders it, with its error code's link. */
export const errorPage = (message: string, code = "nopermissions") =>
  `<div data-rel="fatalerror"><p class="errormessage">${message}</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/moodle/${code}">More information about this error</a></p></div>`;

/** The user plan, reduced: the current phase's `dt` active. */
export const plan = (active: number) =>
  `<div class="userplan">${[10, 20, 30, 40, 50].map((code) => `<dl class="phase"><dt class="phase${code} ${code === active ? "active" : "nonactive"}"></dt></dl>`).join("")}</div>`;

/** A submission (or an example: no author) as `render_workshop_submission` renders it. */
export function submissionBox(s: { id: number; title: string; content: string; author?: [number, string]; files?: string[]; linked?: boolean; example?: boolean }): string {
  const title = s.linked ? `<a href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=${s.id}">${s.title}</a>` : s.title;
  const files = (s.files ?? [])
    .map((name) => `<li class="text/plain"><a href="${SITE}pluginfile.php/99/mod_workshop/submission_attachment/${s.id}/${encodeURIComponent(name)}?forcedownload=1"><img class="icon">${name}</a></li>`)
    .join("");
  return `<div class="submission-full${s.example ? " example" : ""}"><div class="header">${s.example ? `<div class="title">${title}</div>` : `<h3 class="title">${title}</h3>`}${
    s.author ? `<div class="author"><div class="picture"></div><div class="fullname">by <a href="${SITE}user/view.php?id=${s.author[0]}&amp;course=3">${s.author[1]}</a></div></div>` : ""
  }</div><div class="content"><div class="no-overflow">${s.content}</div></div><div class="attachments"><ul class="files">${files}</ul></div></div>`;
}

/** A single button as `$OUTPUT->single_button` renders it: a form with its params as hidden inputs. */
export const button = (path: string, params: Record<string, string>, method = "get") =>
  `<div class="singlebutton"><form method="${method}" action="${SITE}${path}">${Object.entries(params)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`)
    .join("")}<button type="submit">Go</button></form></div>`;

/** The submission form (`workshop_submission_form`), a submission's or an example's, with its draft areas 111 (content) and 777 (attachments). */
export const submissionForm = (path: string, current: { title: string; content: string }, example = 0) =>
  `<form class="mform" method="post" action="${SITE}${path}"><input name="_qf__workshop_submission_form" type="hidden" value="1">
<input name="title" id="id_title" value="${current.title}"><div class="invalid-feedback" id="id_error_title"></div>
<textarea name="content_editor[text]" id="id_content_editor">${current.content}</textarea><input type="hidden" name="content_editor[format]" value="1"><input type="hidden" name="content_editor[itemid]" value="111">
<input name="attachment_filemanager" type="hidden" value="777"><input name="example" type="hidden" value="${example}">
<input type="submit" name="submitbutton" value="Save changes"></form>
<script>var filepicker = {"repositories":{"4":{"id":"4","name":"Upload a file","type":"upload"}}};</script>`;

/** The file manager's draft area: draftfiles_ajax.php's listing and deleting, repository_ajax.php's upload; files by name. */
export async function serveDraftArea(context: BrowserContext, draft: Set<string>): Promise<void> {
  await context.route(`${SITE}repository/draftfiles_ajax.php**`, (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const form = new URLSearchParams(route.request().postData() ?? "");
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (action === "list") return json({ list: [...draft].map((filename) => ({ type: "file", filepath: "/", filename, size: 1 })) });
    if (action === "delete") return json(draft.delete(form.get("filename") ?? "") ? { filepath: "/" } : false);
    return json(false);
  });
  await context.route(`${SITE}repository/repository_ajax.php**`, (route) => {
    const name = /filename="([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "";
    draft.add(name);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/9/user/draft/777/${name}` }) });
  });
}

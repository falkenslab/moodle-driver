import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readDiscussionRows } from "../../../src/index.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

/** A discussion row as Moodle 5.2's forum page renders it, reduced; the data is made up. */
function row(id: number, subject: string, author: string, started: number, last: { author: string; time: number; post: number }, replies: number, locked = false, pinned = false): string {
  return `<tr class="discussion${pinned ? " pinned" : ""}" data-region="discussion-list-item" data-discussionid="${id}" data-forumid="1">
<td><a data-type="favorite-toggle" data-discussionid="${id}" href=""></a></td>
<th scope="row"><a href="${SITE}mod/forum/discuss.php?d=${id}"> ${subject} </a><span data-region="locked-label"${locked ? "" : " hidden"}>Locked</span></th>
<td><div><img alt="Picture of ${author}"></div><div><div>${author}</div><div><time data-timestamp="${started}">2 Oct</time></div></div></td>
<td><div><div>${last.author}</div><div><a href="${SITE}mod/forum/discuss.php?d=${id}&amp;parent=${last.post}"><time data-timestamp="${last.time}">3 Oct</time></a></div></div></td>
<td><span>${replies}</span></td>
<td><input type="checkbox" data-type="subscription-toggle"><label>Subscribe</label></td>
</tr>`;
}

const FORUM_PAGE = `<table>${row(2, "Can a variable change?", "Ada Lovelace", 1_790_000_000, { author: "Alan Turing", time: 1_790_000_600, post: 3 }, 1, false, true)}${row(1, "Bool question", "Grace Hopper", 1_789_000_000, { author: "Grace Hopper", time: 1_789_000_000, post: 1 }, 0, true)}</table>`;

describe("readDiscussionRows", { skip: !browser && "no system browser" }, () => {
  it("reads subject, people, times, replies, lock and pin without the page's texts", async () => {
    const page = await browser!.newPage();
    await page.setContent(FORUM_PAGE);
    assert.deepEqual(await readDiscussionRows(page), [
      { id: 2, subject: "Can a variable change?", author: "Ada Lovelace", started: 1_790_000_000, lastPost: { author: "Alan Turing", time: 1_790_000_600, postId: 3 }, replies: 1, locked: false, pinned: true, forumInstanceId: 1 },
      { id: 1, subject: "Bool question", author: "Grace Hopper", started: 1_789_000_000, lastPost: { author: "Grace Hopper", time: 1_789_000_000, postId: 1 }, replies: 0, locked: true, pinned: false, forumInstanceId: 1 },
    ]);
    await page.close();
  });
});


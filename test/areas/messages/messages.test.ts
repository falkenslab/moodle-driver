import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { MessageError, MoodleError, conversation, conversations, markNotificationsRead, messageParticipants, notifications, sendMessage } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// Made-up messaging for user 4: two notifications, a conversation with a teacher (user 3).
function fakeMessaging(): FakeMoodleState {
  const unread = new Set([16, 15]);
  return {
    user: { id: 4, fullName: "Ana Student" },
    serviceCalls: [],
    services: {
      message_popup_get_popup_notifications: () => ({
        notifications: [
          { id: 16, useridfrom: 3, subject: "Reply in &quot;Loops&quot;", fullmessage: "Teacher replied.", smallmessage: "", contexturl: `${SITE}mod/forum/discuss.php?d=4#p8`, timecreated: 1_790_000_100, read: unread.has(16), component: "mod_forum", eventtype: "posts" },
          { id: 15, useridfrom: -10, subject: "New sign in", fullmessage: "", smallmessage: "Someone signed in.", contexturl: null, timecreated: 1_790_000_000, read: !unread.has(15) },
        ].map((n) => ({ ...n, read: !unread.has(n.id) })),
        unreadcount: unread.size,
      }),
      core_message_mark_all_notifications_as_read: () => {
        unread.clear();
        return true;
      },
      core_message_get_conversations: () => ({
        conversations: [{ id: 6, type: 1, name: null, members: [{ id: 3, fullname: "Teacher Uno" }], unreadcount: 1, messages: [{ id: 1, useridfrom: 3, text: "<p>Did you see <b>the reply</b>?</p>", timecreated: 1_790_000_200 }] }],
      }),
      // As Moodle's: its `members` are the messages' senders, not the conversation's.
      core_message_get_conversation_messages: ({ convid }) =>
        convid === 7
          ? { id: 7, members: [{ id: 4, fullname: "Ana Student" }], messages: [{ id: 4, useridfrom: 4, text: "<p>A question</p>", timecreated: 1_790_000_400 }] }
          : convid === 1
            ? { id: 1, members: [], messages: [] }
            : {
                id: convid,
                members: [
                  { id: 3, fullname: "Teacher Uno" },
                  { id: 4, fullname: "Ana Student" },
                ],
                messages: [
                  { id: 1, useridfrom: 3, text: "<p>Did you see the reply?</p>", timecreated: 1_790_000_200 },
                  { id: 2, useridfrom: 4, text: "<p>Yes, thanks.</p>", timecreated: 1_790_000_300 },
                ],
              },
      // Every member, the person included; conversation 1 is the person's own.
      core_message_get_conversation_members: ({ conversationid }) =>
        conversationid === 1
          ? [{ id: 4, fullname: "Ana Student" }]
          : [
              { id: 3, fullname: "Teacher Uno" },
              { id: 4, fullname: "Ana Student" },
            ],
      core_message_send_instant_messages: ({ messages }) => {
        const [message] = messages as { touserid: number }[];
        return message!.touserid === 9 ? [{ msgid: -1, errormessage: "This user has blocked you." }] : [{ msgid: 3, conversationid: 6, text: "x", timecreated: 1 }];
      },
    },
  };
}

async function open(state: FakeMoodleState): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, state);
  return context;
}

describe("notifications", { skip: !browser && "no system browser" }, () => {
  it("lists them with plain text and where they lead, and marks them all read", async () => {
    const state = fakeMessaging();
    const context = await open(state);
    const [reply, signIn] = await notifications(context, SITE);
    assert.deepEqual(reply, {
      id: 16,
      subject: 'Reply in "Loops"',
      text: "Teacher replied.",
      fromUserId: 3,
      time: new Date(1_790_000_100_000).toISOString(),
      read: false,
      url: `${SITE}mod/forum/discuss.php?d=4#p8`,
      component: "mod_forum",
      eventType: "posts",
    });
    assert.equal(signIn?.text, "Someone signed in.");
    await markNotificationsRead(context, SITE);
    assert.deepEqual(state.serviceCalls!.find((c) => c.methodname === "core_message_mark_all_notifications_as_read")?.args, { useridto: 4 });
    assert.deepEqual(await notifications(context, SITE, { unreadOnly: true }), []);
    await context.close();
  });
});

/** Five notifications (ids 5 to 1, newest first; the even ones read), five conversations and a conversation of five messages, paged as Moodle's services do. */
function fakeLongLists(): FakeMoodleState {
  const window = <T>(all: T[], from: unknown, count: unknown) => all.slice(from as number, (count as number) ? (from as number) + (count as number) : undefined);
  const notes = [5, 4, 3, 2, 1].map((id) => ({ id, useridfrom: 3, subject: `Note ${id}`, fullmessage: "x", smallmessage: "", timecreated: 1_790_000_000 + id, read: id % 2 === 0 }));
  const messages = [1, 2, 3, 4, 5].map((id) => ({ id, useridfrom: 3, text: `<p>Message ${id}</p>`, timecreated: 1_790_000_000 + id }));
  return {
    user: { id: 4, fullName: "Ana Student" },
    serviceCalls: [],
    services: {
      message_popup_get_popup_notifications: ({ limit, offset }) => ({ notifications: window(notes, offset, limit), unreadcount: 3 }),
      core_message_get_conversations: ({ limitfrom, limitnum }) => ({
        conversations: window([10, 9, 8, 7, 6].map((id) => ({ id, type: 1, name: null, members: [{ id: 3, fullname: "Teacher Uno" }], unreadcount: 0, messages: [] })), limitfrom, limitnum),
      }),
      core_message_get_conversation_members: () => [{ id: 3, fullname: "Teacher Uno" }, { id: 4, fullname: "Ana Student" }],
      core_message_get_conversation_messages: ({ convid, limitfrom, limitnum, newest }) => ({ id: convid, members: [], messages: window(newest ? [...messages].reverse() : messages, limitfrom, limitnum) }),
    },
  };
}

describe("long lists of messages", { skip: !browser && "no system browser" }, () => {
  it("pages notifications through the service, newest first, and the unread ones counted as unread", async () => {
    const state = fakeLongLists();
    const context = await open(state);
    const ids = (page: { items: { id: number }[]; more: boolean }) => [page.items.map((n) => n.id), page.more];
    assert.deepEqual(ids(await notifications(context, SITE, { limit: 2 })), [[5, 4], true]);
    assert.deepEqual(state.serviceCalls!.at(-1)?.args, { useridto: 0, limit: 3, offset: 0 });
    assert.deepEqual(ids(await notifications(context, SITE, { limit: 2, offset: 2 })), [[3, 2], true]);
    assert.deepEqual(ids(await notifications(context, SITE, { limit: 2, offset: 4 })), [[1], false]);
    assert.deepEqual(ids(await notifications(context, SITE, { unreadOnly: true, limit: 2 })), [[5, 3], true]);
    assert.deepEqual(ids(await notifications(context, SITE, { unreadOnly: true, limit: 2, offset: 2 })), [[1], false]);
    // Without limit, the list as before.
    assert.deepEqual((await notifications(context, SITE)).map((n) => n.id), [5, 4, 3, 2, 1]);
    assert.deepEqual(state.serviceCalls!.at(-1)?.args, { useridto: 0, limit: 0, offset: 0 });
    assert.deepEqual((await notifications(context, SITE, { unreadOnly: true })).map((n) => n.id), [5, 3, 1]);
    await assert.rejects(notifications(context, SITE, { limit: 0 }), (error: MoodleError) => error.code === "invalid-input");
    await context.close();
  });

  it("pages conversations through the service", async () => {
    const state = fakeLongLists();
    const context = await open(state);
    const first = await conversations(context, SITE, { limit: 2 });
    assert.deepEqual([first.items.map((c) => c.id), first.more], [[10, 9], true]);
    assert.deepEqual(state.serviceCalls!.at(-1)?.args, { userid: 4, limitfrom: 0, limitnum: 3 });
    const next = await conversations(context, SITE, { limit: 2, offset: 2 });
    assert.deepEqual([next.items.map((c) => c.id), next.more], [[8, 7], true]);
    const last = await conversations(context, SITE, { limit: 2, offset: 4 });
    assert.deepEqual([last.items.map((c) => c.id), last.more], [[6], false]);
    assert.deepEqual((await conversations(context, SITE)).map((c) => c.id), [10, 9, 8, 7, 6]);
    await context.close();
  });

  it("pages a conversation's messages from the newest, each page oldest first", async () => {
    const state = fakeLongLists();
    const context = await open(state);
    const texts = (page: { items: { text: string }[]; more: boolean }) => [page.items.map((m) => m.text), page.more];
    const first = await conversation(context, SITE, 6, { limit: 2 });
    assert.deepEqual(texts(first.messages), [["Message 4", "Message 5"], true]);
    assert.deepEqual(first.members, [{ userId: 3, fullName: "Teacher Uno" }]);
    assert.deepEqual(state.serviceCalls!.at(-1)?.args, { currentuserid: 4, convid: 6, limitfrom: 0, limitnum: 3, newest: true });
    assert.deepEqual(texts((await conversation(context, SITE, 6, { limit: 2, offset: 2 })).messages), [["Message 2", "Message 3"], true]);
    assert.deepEqual(texts((await conversation(context, SITE, 6, { limit: 2, offset: 4 })).messages), [["Message 1"], false]);
    assert.deepEqual((await conversation(context, SITE, 6)).messages.map((m) => m.text), ["Message 1", "Message 2", "Message 3", "Message 4", "Message 5"]);
    assert.deepEqual(state.serviceCalls!.at(-1)?.args, { currentuserid: 4, convid: 6, limitfrom: 0, limitnum: 0, newest: false });
    await context.close();
  });
});

describe("conversations and messages", { skip: !browser && "no system browser" }, () => {
  it("lists conversations and reads one oldest first, as text", async () => {
    const context = await open(fakeMessaging());
    assert.deepEqual(await conversations(context, SITE), [
      { id: 6, type: "private", members: [{ userId: 3, fullName: "Teacher Uno" }], unread: 1, lastMessage: { fromUserId: 3, text: "Did you see the reply?", time: new Date(1_790_000_200_000).toISOString() } },
    ]);
    const read = await conversation(context, SITE, 6);
    assert.deepEqual(read.messages.map((m) => [m.fromUserId, m.text]), [
      [3, "Did you see the reply?"],
      [4, "Yes, thanks."],
    ]);
    assert.deepEqual(read.members, [{ userId: 3, fullName: "Teacher Uno" }]);
    await context.close();
  });

  it("gives every other member, also those who haven't written, and the person in their own conversation", async () => {
    const state = fakeMessaging();
    const context = await open(state);
    assert.deepEqual((await conversation(context, SITE, 7)).members, [{ userId: 3, fullName: "Teacher Uno" }]);
    assert.deepEqual(state.serviceCalls!.find((c) => c.methodname === "core_message_get_conversation_members")?.args, { userid: 4, conversationid: 7, includecontactrequests: false, includeprivacyinfo: false, limitfrom: 0, limitnum: 0 });
    assert.deepEqual((await conversation(context, SITE, 1)).members, [{ userId: 4, fullName: "Ana Student" }]);
    await context.close();
  });

  it("sends a message, and refuses an empty one or what Moodle refuses", async () => {
    const state = fakeMessaging();
    const context = await open(state);
    assert.deepEqual(await sendMessage(context, SITE, 3, "<p>Hello</p>"), { changed: "Message 3 sent to user 3.", messageId: 3, conversationId: 6 });
    await assert.rejects(sendMessage(context, SITE, 3, "<p>&nbsp;</p>"), /The message is empty/);
    await assert.rejects(sendMessage(context, SITE, 9, "Hi"), (error: Error) => error instanceof MessageError && /blocked you/.test(error.message));
    await context.close();
  });
});

describe("messageParticipants", { skip: !browser && "no system browser" }, () => {
  // Course 3 as the teacher (user 3) sees it: the teacher, Ana (group 1) and Bruno (group 1, who blocked the teacher), Carla.
  const PEOPLE = [
    { id: 3, groups: [] as number[] },
    { id: 4, groups: [1] },
    { id: 5, groups: [1] },
    { id: 6, groups: [] as number[] },
  ];
  const tableRow = (id: number) => `<tr><th scope="row"><a href="${SITE}user/view.php?id=${id}&amp;course=3">User ${id}</a></th></tr>`;

  async function course() {
    const state: FakeMoodleState = {
      user: { id: 3, fullName: "Teacher" },
      serviceCalls: [],
      services: {
        core_table_get_dynamic_table_content: (args) => {
          const group = (args.filters as { name: string; values: number[] }[]).find((f) => f.name === "groups")?.values[0];
          const rows = PEOPLE.filter((p) => group === undefined || p.groups.includes(group)).map((p) => tableRow(p.id));
          return { html: `<table><tbody>${rows.join("")}</tbody></table>` };
        },
        // Moodle answers each message in order; Bruno blocked the sender.
        core_message_send_instant_messages: (args) =>
          (args.messages as { touserid: number }[]).map((m) => (m.touserid === 5 ? { msgid: -1, errormessage: "This user has blocked you." } : { msgid: 100 + m.touserid, conversationid: 7 })),
      },
    };
    const context: BrowserContext = await browser!.newContext();
    await serveFakeMoodle(context, state);
    const filters = `<select data-field-name="roles"><option value="5">Student</option></select><select data-field-name="groups"><option value="1">Group A</option></select>`;
    await context.route(`${SITE}user/index.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-course-view-participants", body: filters }) }));
    return { context, state };
  }

  it("writes to a group's participants in one call, and lists who Moodle refused", async () => {
    const { context, state } = await course();
    assert.deepEqual(await messageParticipants(context, SITE, 3, "<p>Hello</p>", { group: 1 }), {
      changed: "Message sent to 1 participant(s) of course 3; refused for 5.",
      sentTo: [4],
      refused: [{ userId: 5, reason: "This user has blocked you." }],
    });
    const sends = state.serviceCalls!.filter((c) => c.methodname === "core_message_send_instant_messages");
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0]!.args.messages, [
      { touserid: 4, text: "<p>Hello</p>", textformat: 1 },
      { touserid: 5, text: "<p>Hello</p>", textformat: 1 },
    ]);
    await context.close();
  });

  it("writes to everyone but the person when no filter is given, and to chosen users as given", async () => {
    const { context } = await course();
    assert.deepEqual((await messageParticipants(context, SITE, 3, "Hi")).sentTo, [4, 6]);
    assert.deepEqual((await messageParticipants(context, SITE, 3, "Hi", { userIds: [6, 6, 4] })).sentTo, [6, 4]);
    await context.close();
  });

  it("refuses an empty message and an empty selection before sending", async () => {
    const { context, state } = await course();
    await assert.rejects(messageParticipants(context, SITE, 3, "<p> </p>", { group: 1 }), MessageError);
    await assert.rejects(messageParticipants(context, SITE, 3, "Hi", { userIds: [] }), MessageError);
    assert.equal(state.serviceCalls!.filter((c) => c.methodname === "core_message_send_instant_messages").length, 0);
    await context.close();
  });
});

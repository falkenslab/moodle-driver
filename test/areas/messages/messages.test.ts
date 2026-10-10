import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { MessageError, conversation, conversations, markNotificationsRead, notifications, sendMessage } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

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
      core_message_get_conversation_messages: ({ convid }) => ({
        id: convid,
        members: [{ id: 3, fullname: "Teacher Uno" }],
        messages: [
          { id: 1, useridfrom: 3, text: "<p>Did you see the reply?</p>", timecreated: 1_790_000_200 },
          { id: 2, useridfrom: 4, text: "<p>Yes, thanks.</p>", timecreated: 1_790_000_300 },
        ],
      }),
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

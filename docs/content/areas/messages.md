# Messages

This area covers the person's Moodle messaging: their notifications (`notifications`, `markNotificationsRead`), their conversations (`conversations`, `conversation`) and sending a private message (`sendMessage`). It works the same for students and teachers, always as the logged-in person: there's no reading someone else's messages. Forum posts are in [Forums](forums.md).

The signatures below are the functions'; each is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Everything goes through the services Moodle's own notification popover and messaging drawer call. People come as a user id and a full name; messages come as plain text (paragraphs and lists kept, markup removed), dates as ISO strings in UTC.

## notifications

The person's notifications, newest first, optionally only the unread ones.

```ts
function notifications(context: BrowserContext, siteUrl: string, options?: { unreadOnly?: boolean }): Promise<Notification[]>;

interface Notification {
  id: number;
  subject: string;
  text: string;
  fromUserId: number;
  time?: string;
  read: boolean;
  url?: string;
  component?: string;
  eventType?: string;
}
```

- `unreadOnly`: default `false`.
- `subject` and `text`: the notification's subject and its message as plain text.
- `fromUserId`: who it's from; a negative id is the site itself (the no-reply or support user).
- `url`: where it leads (the post, the assignment, the graded submission…).
- `component` and `eventType`: what sent it, such as `"mod_forum"` with `"posts"`, or `"mod_assign"`; useful to filter by kind in any language.

It reads `message_popup_get_popup_notifications`, the popover's service, without a limit.

### Forum notifications come later

Moodle doesn't notify a forum post when it's written. Its scheduled tasks (cron) send forum notifications afterwards, once the post's editing time has passed (30 minutes by default, the site's "Maximum editing time"). A program that replies with `replyToPost` and then reads the recipient's notifications won't find it at once; how soon it arrives depends on the site's cron, not on the driver. Private messages sent with `sendMessage` show in the conversation immediately.

## markNotificationsRead

Marks all the person's notifications read, as the popover's "Mark all as read" does. Doing it twice changes nothing.

```ts
function markNotificationsRead(context: BrowserContext, siteUrl: string): Promise<{ changed: string }>;
```

It goes through `core_message_mark_all_notifications_as_read` for the logged-in user. There's no marking a single notification.

## conversations

The person's conversations, latest first, each with its last message.

```ts
function conversations(context: BrowserContext, siteUrl: string): Promise<ConversationSummary[]>;

interface ConversationSummary {
  id: number;
  type: "private" | "group" | "self";
  name?: string;
  members: { userId: number; fullName: string }[];
  unread: number;
  lastMessage?: { fromUserId: number; text: string; time?: string };
}
```

- `type`: `"private"` between two people, `"group"` for a course group's conversation (with the group's `name`), `"self"` for the person's notes to themselves.
- `members`: the members Moodle returns with it (in a private conversation, the other person).
- `unread`: how many messages the person hasn't read.
- `lastMessage`: its sender, its text and when it was sent.

It reads `core_message_get_conversations`, the drawer's service.

## conversation

One conversation's members and messages, oldest first.

```ts
function conversation(context: BrowserContext, siteUrl: string, conversationId: number): Promise<{
  id: number;
  members: { userId: number; fullName: string }[];
  messages: { id: number; fromUserId: number; text: string; time?: string }[];
}>;
```

`conversationId` is an `id` from `conversations`, or the `conversationId` that `sendMessage` returns. It reads `core_message_get_conversation_messages`; the person must be a member, or Moodle refuses with a `MoodleServiceError` (see [Errors](../concepts/errors.md)).

## sendMessage

Sends a private message to a user, as the messaging drawer does, and returns the message's id and its conversation.

```ts
function sendMessage(context: BrowserContext, siteUrl: string, userId: number, text: string): Promise<{ changed: string; messageId: number; conversationId?: number }>;
```

- `userId`: the recipient (a participant's `userId`, see [Participants](participants.md)).
- `text`: the message as HTML (`"<p>Hello</p>"`); plain text works too.

It throws `MessageError`:

- before sending anything, when the text is empty once its markup and non-breaking spaces are removed;
- when Moodle doesn't deliver it, with Moodle's reason (the recipient blocked the person, for instance).

It goes through `core_message_send_instant_messages`.

## Example

Read the unread notifications, then answer a student's latest message.

```ts
import { MessageError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

for (const notification of await moodle.notifications({ unreadOnly: true })) {
  console.log(`[${notification.component ?? "site"}] ${notification.subject}`);
}
await moodle.markNotificationsRead();

const [latest] = await moodle.conversations();
const other = latest?.members.find((m) => m.userId === 7);
if (latest?.type === "private" && other && latest.unread > 0) {
  try {
    const sent = await moodle.sendMessage(other.userId, "<p>Thanks, Ada. I'll check it tomorrow.</p>");
    console.log(sent.changed);
  } catch (error) {
    if (error instanceof MessageError) console.log(error.message);
    else throw error;
  }
}
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `notifications`, `markNotificationsRead`: `own`.
- `conversations`, `conversation`: `others-personal` (they hold others' messages).
- `sendMessage`: `communication` (writing to others).

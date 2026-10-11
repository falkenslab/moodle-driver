// The person's notifications and conversations, and messaging someone, through the services the
// notification popover and the messaging drawer use (ADR-004). People as user id and full name.
import type { BrowserContext } from "playwright-core";
import { callService, readPageConfig } from "../../core/ajax.js";
import { isoDate } from "../courses/list.js";
import { htmlToTexts } from "../forums/discussions.js";
import { decodeEntities } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";
import { participants } from "../participants/participants.js";

/** Moodle didn't deliver a message. */
export class MessageError extends MoodleError {
  override name = "MessageError";
  constructor(message: string) {
    super(message, "message");
  }
}

/** A notification the site sent the person, as `notifications` lists it. */
export interface Notification {
  id: number;
  subject: string;
  /** The notification's text, plain. */
  text: string;
  /** Who it's from: a user id, or a negative one for the site itself (noreply, support). */
  fromUserId: number;
  time?: string;
  read: boolean;
  /** Where it leads (the post, the assignment…). */
  url?: string;
  /** What sent it: "mod_forum", "mod_assign"… and its kind. */
  component?: string;
  eventType?: string;
}

/** A notification as `message_popup_get_popup_notifications` returns it (Moodle 5.2), the fields read. */
interface MoodleNotification {
  id: number;
  useridfrom: number;
  subject: string;
  fullmessage: string;
  smallmessage: string;
  contexturl?: string | null;
  timecreated: number;
  read: boolean;
  component?: string;
  eventtype?: string;
}

/** The person's notifications, newest first, only the unread ones when asked. */
export async function notifications(context: BrowserContext, siteUrl: string, { unreadOnly = false }: { unreadOnly?: boolean } = {}): Promise<Notification[]> {
  const { notifications: found } = await callService<{ notifications: MoodleNotification[] }>(context, siteUrl, "message_popup_get_popup_notifications", { useridto: 0, limit: 0, offset: 0 });
  return found
    .filter((n) => !unreadOnly || !n.read)
    .map((n) => ({
      id: n.id,
      subject: decodeEntities(n.subject),
      text: decodeEntities(n.fullmessage || n.smallmessage).trim(),
      fromUserId: n.useridfrom,
      time: isoDate(n.timecreated),
      read: n.read,
      ...(n.contexturl ? { url: n.contexturl } : {}),
      ...(n.component ? { component: n.component } : {}),
      ...(n.eventtype ? { eventType: n.eventtype } : {}),
    }));
}

/** Marks all the person's notifications read, as the popover's "Mark all as read" does; doing it twice changes nothing. */
export async function markNotificationsRead(context: BrowserContext, siteUrl: string): Promise<{ changed: string }> {
  const { userId } = await readPageConfig(context, siteUrl);
  await callService(context, siteUrl, "core_message_mark_all_notifications_as_read", { useridto: userId });
  return { changed: "All notifications marked read." };
}

/** A conversation's types, by Moodle's MESSAGE_CONVERSATION_TYPE_* values. */
const CONVERSATION_TYPES: Record<number, "private" | "group" | "self"> = { 1: "private", 2: "group", 3: "self" };

interface MoodleConversationMessage {
  id: number;
  useridfrom: number;
  text: string;
  timecreated: number;
}

interface MoodleMember {
  id: number;
  fullname: string;
}

/** One of the person's conversations, as `conversations` lists it, with its last message. */
export interface ConversationSummary {
  id: number;
  /** With one other person, a course group's, or the person's own (notes to self). */
  type: "private" | "group" | "self";
  /** A group conversation's name (its course group). */
  name?: string;
  /** Everyone in it but the person. */
  members: { userId: number; fullName: string }[];
  /** The person's unread messages in it. */
  unread: number;
  lastMessage?: { fromUserId: number; text: string; time?: string };
}

/** The person's conversations, latest first, with their last message as text. */
export async function conversations(context: BrowserContext, siteUrl: string): Promise<ConversationSummary[]> {
  const { userId } = await readPageConfig(context, siteUrl);
  const { conversations: found } = await callService<{
    conversations: { id: number; type: number; name?: string | null; members: MoodleMember[]; unreadcount?: number | null; messages: MoodleConversationMessage[] }[];
  }>(context, siteUrl, "core_message_get_conversations", { userid: userId, limitfrom: 0, limitnum: 0 });
  const texts = await htmlToTexts(
    context,
    found.map((c) => c.messages[0]?.text ?? ""),
  );
  return found.map((c, i) => {
    const last = c.messages[0];
    return {
      id: c.id,
      type: CONVERSATION_TYPES[c.type] ?? "private",
      ...(c.name ? { name: decodeEntities(c.name) } : {}),
      members: c.members.map((m) => ({ userId: m.id, fullName: m.fullname })),
      unread: c.unreadcount ?? 0,
      ...(last ? { lastMessage: { fromUserId: last.useridfrom, text: texts[i] ?? "", time: isoDate(last.timecreated) } } : {}),
    };
  });
}

/**
 * A conversation's messages, oldest first, as text, and its members as `conversations()` gives them:
 * everyone but the person, whether they wrote in it or not (the person alone in their own conversation).
 */
export async function conversation(context: BrowserContext, siteUrl: string, conversationId: number) {
  const { userId } = await readPageConfig(context, siteUrl);
  // Every member, the person included.
  const everyone = await callService<MoodleMember[]>(context, siteUrl, "core_message_get_conversation_members", {
    userid: userId,
    conversationid: conversationId,
    includecontactrequests: false,
    includeprivacyinfo: false,
    limitfrom: 0,
    limitnum: 0,
  });
  const others = everyone.filter((m) => m.id !== userId);
  // Only the messages: this service's `members` are the messages' senders, not the conversation's.
  const found = await callService<{ id: number; messages: MoodleConversationMessage[] }>(context, siteUrl, "core_message_get_conversation_messages", {
    currentuserid: userId,
    convid: conversationId,
    limitfrom: 0,
    limitnum: 0,
    newest: false,
  });
  const texts = await htmlToTexts(
    context,
    found.messages.map((m) => m.text),
  );
  return {
    id: found.id,
    members: (others.length > 0 ? others : everyone).map((m) => ({ userId: m.id, fullName: m.fullname })),
    messages: found.messages.map((m, i) => ({ id: m.id, fromUserId: m.useridfrom, text: texts[i] ?? "", time: isoDate(m.timecreated) })),
  };
}

function checkNotEmpty(text: string): void {
  if (text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "") throw new MessageError("The message is empty: write something before sending it.");
}

/** Sends a private message to a user, as the messaging drawer does; returns the message and its conversation. */
export async function sendMessage(context: BrowserContext, siteUrl: string, userId: number, text: string): Promise<{ changed: string; messageId: number; conversationId?: number }> {
  checkNotEmpty(text);
  const [sent] = await callService<{ msgid: number; conversationid?: number; errormessage?: string }[]>(context, siteUrl, "core_message_send_instant_messages", {
    messages: [{ touserid: userId, text, textformat: 1 }],
  });
  // A refused message comes back with id -1 and Moodle's reason (blocked, not a contact…).
  if (!sent || sent.msgid < 0) throw new MessageError(`Moodle didn't send the message to user ${userId}: ${sent?.errormessage ?? "no reason given"}`);
  return { changed: `Message ${sent.msgid} sent to user ${userId}.`, messageId: sent.msgid, ...(sent.conversationid ? { conversationId: sent.conversationid } : {}) };
}

/** Who `messageParticipants` writes to: chosen users, or the participants `participants()` chooses with these filters. */
export type ParticipantSelection = { userIds: number[] } | { role?: number; group?: number; inactiveSince?: Date };

/**
 * Sends one message to several participants of a course, as the participants page's "Send a message"
 * does for the users selected: one private message each, in one call. They are `userIds`, or the
 * participants `participants()` chooses with `role`, `group` and `inactiveSince` (all of them when
 * none is given), the person left out. `sentTo` lists exactly who got it, `refused` who Moodle
 * didn't write to and why (they blocked the person, their privacy settings); someone who may message
 * any user (a teacher, `moodle/site:messageanyuser`) gets through a block, as in Moodle's own page
 * (confirmed empirically, Moodle 5.2). Throws `MessageError`
 * for an empty message or nobody to write to, `NoParticipantsError` when the person can't see the
 * course's participants.
 */
export async function messageParticipants(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  text: string,
  selection: ParticipantSelection = {},
): Promise<{ changed: string; sentTo: number[]; refused: { userId: number; reason: string }[] }> {
  checkNotEmpty(text);
  let userIds: number[];
  if ("userIds" in selection) userIds = [...new Set(selection.userIds)];
  else {
    const { userId: me } = await readPageConfig(context, siteUrl);
    userIds = (await participants(context, siteUrl, courseId, selection)).map((p) => p.userId).filter((id) => id !== me);
  }
  if (userIds.length === 0) throw new MessageError(`Nobody to write to in course ${courseId}: no participant matches.`);
  const sent = await callService<{ msgid: number; errormessage?: string }[]>(context, siteUrl, "core_message_send_instant_messages", {
    messages: userIds.map((touserid) => ({ touserid, text, textformat: 1 })),
  });
  // One answer per message, in order; a refused one has id -1 and Moodle's reason.
  const sentTo: number[] = [];
  const refused: { userId: number; reason: string }[] = [];
  userIds.forEach((userId, i) => {
    const answer = sent[i];
    if (answer && answer.msgid >= 0) sentTo.push(userId);
    else refused.push({ userId, reason: answer?.errormessage ?? "no reason given" });
  });
  const refusedText = refused.length > 0 ? `; refused for ${refused.map((r) => r.userId).join(", ")}` : "";
  return { changed: `Message sent to ${sentTo.length} participant(s) of course ${courseId}${refusedText}.`, sentTo, refused };
}

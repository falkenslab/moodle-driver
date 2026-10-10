// The person's notifications and conversations, and messaging someone, through the services the
// notification popover and the messaging drawer use (ADR-004). People as user id and full name.
import type { BrowserContext } from "playwright-core";
import { callService, readPageConfig } from "../../core/ajax.js";
import { isoDate } from "../courses/list.js";
import { htmlToTexts } from "../forums/discussions.js";
import { decodeEntities } from "../../core/text.js";
import { MoodleDriverError } from "../../core/errors.js";

/** Moodle didn't deliver a message. */
export class MessageError extends MoodleDriverError {
  override name = "MessageError";
  constructor(message: string) {
    super(message, "message");
  }
}

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

export interface ConversationSummary {
  id: number;
  type: "private" | "group" | "self";
  /** A group conversation's name (its course group). */
  name?: string;
  members: { userId: number; fullName: string }[];
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

/** A conversation's members and messages, oldest first, as text. */
export async function conversation(context: BrowserContext, siteUrl: string, conversationId: number) {
  const { userId } = await readPageConfig(context, siteUrl);
  const found = await callService<{ id: number; members: MoodleMember[]; messages: MoodleConversationMessage[] }>(context, siteUrl, "core_message_get_conversation_messages", {
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
    members: found.members.map((m) => ({ userId: m.id, fullName: m.fullname })),
    messages: found.messages.map((m, i) => ({ id: m.id, fromUserId: m.useridfrom, text: texts[i] ?? "", time: isoDate(m.timecreated) })),
  };
}

/** Sends a private message to a user, as the messaging drawer does; returns the message and its conversation. */
export async function sendMessage(context: BrowserContext, siteUrl: string, userId: number, text: string): Promise<{ changed: string; messageId: number; conversationId?: number }> {
  if (text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() === "") throw new MessageError("The message is empty: write something before sending it.");
  const [sent] = await callService<{ msgid: number; conversationid?: number; errormessage?: string }[]>(context, siteUrl, "core_message_send_instant_messages", {
    messages: [{ touserid: userId, text, textformat: 1 }],
  });
  // A refused message comes back with id -1 and Moodle's reason (blocked, not a contact…).
  if (!sent || sent.msgid < 0) throw new MessageError(`Moodle didn't send the message to user ${userId}: ${sent?.errormessage ?? "no reason given"}`);
  return { changed: `Message ${sent.msgid} sent to user ${userId}.`, messageId: sent.msgid, ...(sent.conversationid ? { conversationId: sent.conversationid } : {}) };
}

// A BigBlueButton activity: its meeting's state, its recordings and managing them, and the person's
// join URL. Moodle's activity page gives the instance id its AJAX services take (meeting_info,
// get_recordings, update_recording); get_join_url and can_join aren't open to AJAX, and meeting_info
// already tells both. The driver never joins a meeting: the person opens the join URL.
import type { BrowserContext, Page } from "playwright-core";
import { callService, MoodleServiceError } from "../../core/ajax.js";
import { inPage } from "../../core/inPage.js";
import { openSitePage } from "../../core/session.js";
import { decodeEntities } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";

/** The activity isn't a BigBlueButton the person can open, or the person lacks the capability for what was asked. */
export class BigBlueButtonError extends MoodleError {
  override name = "BigBlueButtonError";
  constructor(message: string) {
    super(message, "bigbluebutton");
  }
}

/** The site's BigBlueButton server isn't configured, or doesn't answer Moodle. */
export class BigBlueButtonServerError extends MoodleError {
  override name = "BigBlueButtonServerError";
  constructor(message: string) {
    super(message, "bigbluebutton-server");
  }
}

/** A recording's playback: its format ("presentation", "video"…) and the Moodle URL that plays it. */
export interface BigBlueButtonPlayback {
  format: string;
  url: string;
}

/** A recording of a BigBlueButton activity, as the person may see it. */
export interface BigBlueButtonRecording {
  /** Moodle's id for the recording, which `setRecordingPublished` and `deleteRecording` take. */
  id: number;
  name: string;
  description?: string;
  /** When the recorded meeting started. */
  date?: string;
  /** The recording's length in minutes, as the server reports it. */
  minutes?: number;
  /** Whether students see it: an unpublished recording is listed only to those who manage recordings. */
  published: boolean;
  /** Whether its playback is protected (only through Moodle), where the server supports it and the person may change it. */
  protected?: boolean;
  /** Imported from another activity's recordings. */
  imported: boolean;
  /** Its playbacks, only while it's published. */
  playbacks: BigBlueButtonPlayback[];
}

/** The meeting's state: not open yet (before its opening time), open, running (someone is in it) or closed (after its closing time). */
export type BigBlueButtonStatus = "not-open-yet" | "open" | "running" | "closed";

/** A BigBlueButton activity as the person sees it (`bigBlueButton`). */
export interface BigBlueButtonActivity {
  id: number;
  name: string;
  status: BigBlueButtonStatus;
  /** The activity's schedule, when it has one. */
  opensAt?: string;
  closesAt?: string;
  /** While running: when it started, and who is in it. */
  startedAt?: string;
  moderators?: number;
  participants?: number;
  /** Whether the person can join now (open, room for them, a moderator there when they must wait, and mod/bigbluebuttonbn:join). */
  canJoin: boolean;
  /** Whether the person joins as a moderator. */
  moderator: boolean;
  /** Whether viewers wait for a moderator before they can join. */
  waitForModerator: boolean;
  /** The most people the meeting takes; none means no limit. */
  userLimit?: number;
  /** The recordings the person may see: all of them for those who manage recordings, the published ones for the rest. */
  recordings: BigBlueButtonRecording[];
}

/** What `meeting_info` answers, as far as the driver reads it. */
interface MeetingInfo {
  cmid: number;
  userlimit: number;
  joinurl: string;
  openingtime?: number;
  closingtime?: number;
  statusrunning?: boolean;
  statusclosed?: boolean;
  statusopen?: boolean;
  startedat?: number;
  moderatorcount?: number;
  participantcount?: number;
  canjoin: boolean;
  ismoderator: boolean;
  usermustwaittojoin?: boolean;
}

/** A row of `get_recordings`' table: HTML pieces rendered by Moodle, the date in milliseconds and the length in minutes. */
interface RecordingRow {
  playback?: string;
  recording?: string;
  description?: string;
  date?: number;
  duration?: number;
  actionbar?: string;
}

interface ViewFacts {
  bigBlueButton: boolean;
  /** Moodle showed a course page instead: where it sends the person when the server doesn't answer. */
  courseShown: boolean;
  name: string;
  instanceId?: number;
  groupId?: number;
  notice: boolean;
}

const MANAGE = "mod/bigbluebuttonbn:managerecordings";
const TOOLS = "protect,unprotect,publish,unpublish,delete";
const notBigBlueButton = (activityId: number) =>
  new BigBlueButtonError(`Activity ${activityId} isn't a BigBlueButton you can open. Take the id of a BigBlueButton activity (module "bigbluebuttonbn") from the course structure.`);
const unconfigured = () =>
  new BigBlueButtonServerError(
    "The site's BigBlueButton server isn't configured: an administrator sets its URL and shared secret in Site administration > Plugins > Activity modules > BigBlueButton.",
  );
const unavailable = (activityId: number) =>
  new BigBlueButtonServerError(`Moodle couldn't reach the site's BigBlueButton server for activity ${activityId}: it is down, or its URL or shared secret in BigBlueButton's settings is wrong.`);
const iso = (seconds: number | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : undefined);

/** The activity's page as Moodle renders it: the instance id is on its room and its recordings table (`data-bbb-id`, `data-bbbid`), or in the call that starts its room. */
function readView(page: Page): Promise<ViewFacts> {
  return page.evaluate(() => {
    interface El {
      id: string;
      innerHTML: string;
      getAttribute(n: string): string | null;
      querySelector(s: string): El | null;
    }
    const doc = (globalThis as unknown as { document: { body: El; documentElement: El } }).document;
    const body = doc.body;
    const holder = body.querySelector("[data-bbb-id]") ?? body.querySelector("[data-bbbid]");
    const fromData = holder?.getAttribute("data-bbb-id") ?? holder?.getAttribute("data-bbbid") ?? "";
    // The page's script starts the room with rooms.init(<instance id>, <poll interval>).
    const fromScript = /mod_bigbluebuttonbn\/rooms[\s\S]*?\.init\(\s*(\d+)/.exec(doc.documentElement.innerHTML)?.[1] ?? "";
    const instance = /^\d+$/.test(fromData) ? fromData : fromScript;
    const group = holder?.getAttribute("data-group-id") ?? "";
    return {
      bigBlueButton: body.id === "page-mod-bigbluebuttonbn-view",
      courseShown: body.id.startsWith("page-course-view"),
      name: body.querySelector("[data-activityname]")?.getAttribute("data-activityname") ?? "",
      ...(instance ? { instanceId: Number(instance) } : {}),
      ...(/^\d+$/.test(group) ? { groupId: Number(group) } : {}),
      // Moodle's notice() when the person may not join: a box with a continue button, nothing else.
      notice: body.querySelector("#notice") !== null,
    };
  });
}

/** The activity's page and what it says: refuses another module, and a site whose server isn't configured or doesn't answer. */
async function openView(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ page: Page; facts: ViewFacts & { instanceId: number } }> {
  const page = await openSitePage(context, siteUrl, `mod/bigbluebuttonbn/view.php?id=${activityId}`);
  try {
    const facts = await readView(page);
    // With a server that doesn't answer, Moodle sends the person back to the course with an error.
    if (!facts.bigBlueButton) {
      if (facts.courseShown) throw unavailable(activityId);
      throw notBigBlueButton(activityId);
    }
    if (facts.instanceId === undefined) {
      if (facts.notice) throw new BigBlueButtonError(`You can't join BigBlueButton ${activityId}: your role lacks mod/bigbluebuttonbn:join there.`);
      // Without a server's URL and secret, Moodle shows a neutral page with no room and no recordings.
      throw unconfigured();
    }
    return { page, facts: { ...facts, instanceId: facts.instanceId } };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** A service's failure in BigBlueButton's terms: the server, a missing capability, or as it came. */
function serviceError(error: unknown, activityId: number, capability?: string): unknown {
  if (!(error instanceof MoodleServiceError)) return error;
  if (/no_answer|server_not_available|unable_join/.test(error.errorcode)) return unavailable(activityId);
  if (capability && (error.errorcode === "nopermissions" || error.errorcode === "accessexception")) {
    return new BigBlueButtonError(`You can't manage BigBlueButton ${activityId}'s recordings: your role lacks ${capability} there.`);
  }
  return error;
}

/** The recordings' rows, read by structure: the id and playbacks from the playback cell, the state from the action bar's icons. */
export function readRecordings(page: Page, rows: RecordingRow[]): Promise<BigBlueButtonRecording[]> {
  // Through inPage: it has helper functions (see the conventions on page.evaluate).
  return inPage(
    page,
    (list: RecordingRow[]) => {
      interface El {
        textContent: string | null;
        outerHTML: string;
        getAttribute(n: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, t: string): { body: El } } };
      const parse = (html: string | undefined) => new g.DOMParser().parseFromString(html ?? "", "text/html").body;
      // An in-place editable keeps the raw value in data-value; without the right to edit, the text alone.
      const value = (html: string | undefined) => {
        const cell = parse(html);
        const editable = cell.querySelector(".inplaceeditable[data-value]");
        return (editable ? editable.getAttribute("data-value") ?? "" : (cell.textContent ?? "")).replace(/\s+/g, " ").trim();
      };
      // The action bar renders every tool; one that doesn't apply has its icon marked fa-invisible.
      const shown = (bar: El, action: string) => {
        const link = bar.querySelector(`a[data-action="${action}"]`);
        return link ? !/\bfa-invisible\b/.test(link.outerHTML) : undefined;
      };
      return list.map((row) => {
        const playback = parse(row.playback);
        const holder = playback.querySelector("[data-recordingid]");
        const playbacks = Array.from(playback.querySelectorAll('a[data-action="play"]')).map((link) => ({ format: link.getAttribute("data-target") ?? "", url: link.getAttribute("href") ?? "" }));
        const bar = row.actionbar ? parse(row.actionbar) : undefined;
        // "unpublish" shows while it's published, "publish" while it isn't; the protect tool shows "unprotect" while protected.
        const unpublish = bar ? shown(bar, "unpublish") : undefined;
        const publish = bar ? shown(bar, "publish") : undefined;
        const unprotect = bar ? shown(bar, "unprotect") : undefined;
        const protect = bar ? shown(bar, "protect") : undefined;
        // Without the tools, only published recordings reach the person.
        const published = unpublish ?? (publish === undefined ? true : !publish);
        const isProtected = unprotect ?? (protect === undefined ? undefined : !protect);
        const description = value(row.description);
        return {
          id: Number(holder?.getAttribute("data-recordingid") ?? 0),
          name: value(row.recording),
          ...(description ? { description } : {}),
          ...(row.date ? { date: new Date(row.date).toISOString() } : {}),
          ...(row.duration ? { minutes: row.duration } : {}),
          published,
          ...(isProtected !== undefined ? { protected: isProtected } : {}),
          imported: !!holder?.getAttribute("data-imported"),
          playbacks,
        };
      });
    },
    rows,
  );
}

async function fetchRecordings(context: BrowserContext, siteUrl: string, page: Page, activityId: number, facts: { instanceId: number; groupId?: number }): Promise<BigBlueButtonRecording[]> {
  let answer: { status: boolean; tabledata?: { data: string }; warnings?: { warningcode?: string; message?: string }[] };
  try {
    answer = await callService(context, siteUrl, "mod_bigbluebuttonbn_get_recordings", { bigbluebuttonbnid: facts.instanceId, tools: TOOLS, ...(facts.groupId ? { groupid: facts.groupId } : {}) });
  } catch (error) {
    throw serviceError(error, activityId);
  }
  // A room-only activity keeps no recordings: Moodle answers with a warning, and there are none to list.
  if (!answer.status || !answer.tabledata) {
    if (answer.warnings?.some((w) => w.warningcode === "instanceprofilewithoutrecordings")) return [];
    throw new BigBlueButtonError(`Moodle didn't list BigBlueButton ${activityId}'s recordings: ${answer.warnings?.map((w) => w.message).join("; ") || "no reason given"}.`);
  }
  const rows = JSON.parse(answer.tabledata.data || "[]") as RecordingRow[];
  return readRecordings(page, rows);
}

async function meetingInfo(context: BrowserContext, siteUrl: string, activityId: number, facts: { instanceId: number; groupId?: number }): Promise<MeetingInfo> {
  try {
    return await callService<MeetingInfo>(context, siteUrl, "mod_bigbluebuttonbn_meeting_info", { bigbluebuttonbnid: facts.instanceId, groupid: facts.groupId ?? 0, updatecache: false });
  } catch (error) {
    throw serviceError(error, activityId);
  }
}

function status(info: MeetingInfo): BigBlueButtonStatus {
  if (info.statusrunning) return "running";
  if (info.statusclosed) return "closed";
  return info.statusopen ? "open" : "not-open-yet";
}

/**
 * A BigBlueButton activity as the person sees it: the meeting's state and schedule, whether the
 * person can join now and as what, and its recordings (all of them for those with
 * mod/bigbluebuttonbn:managerecordings, the published ones for the rest). Reads the activity's page
 * (Moodle logs a view) and the meeting from the BigBlueButton server, through Moodle. Throws
 * `BigBlueButtonServerError` when the site's server isn't configured or doesn't answer, never an empty state.
 */
export async function bigBlueButton(context: BrowserContext, siteUrl: string, activityId: number): Promise<BigBlueButtonActivity> {
  const { page, facts } = await openView(context, siteUrl, activityId);
  try {
    const info = await meetingInfo(context, siteUrl, activityId, facts);
    const recordings = await fetchRecordings(context, siteUrl, page, activityId, facts);
    const running = !!info.statusrunning;
    return {
      id: activityId,
      name: decodeEntities(facts.name),
      status: status(info),
      ...(iso(info.openingtime) ? { opensAt: iso(info.openingtime) } : {}),
      ...(iso(info.closingtime) ? { closesAt: iso(info.closingtime) } : {}),
      ...(running && iso(info.startedat) ? { startedAt: iso(info.startedat) } : {}),
      ...(running && info.moderatorcount !== undefined ? { moderators: info.moderatorcount } : {}),
      ...(running && info.participantcount !== undefined ? { participants: info.participantcount } : {}),
      canJoin: info.canjoin,
      moderator: info.ismoderator,
      waitForModerator: !!info.usermustwaittojoin,
      ...(info.userlimit > 0 ? { userLimit: info.userlimit } : {}),
      recordings,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * The person's URL to join a BigBlueButton meeting: Moodle's join page, which creates the meeting
 * if needed and sends the person into it. For the person to open in their browser; the driver never
 * joins. Throws `BigBlueButtonError` saying why when the person can't join now (not open yet,
 * closed, waiting for a moderator, full, or no mod/bigbluebuttonbn:join).
 */
export async function bigBlueButtonJoinUrl(context: BrowserContext, siteUrl: string, activityId: number): Promise<string> {
  const { page, facts } = await openView(context, siteUrl, activityId);
  await page.close().catch(() => undefined);
  const info = await meetingInfo(context, siteUrl, activityId, facts);
  if (!info.canjoin) {
    const state = status(info);
    const why =
      state === "not-open-yet"
        ? `it opens at ${iso(info.openingtime) ?? "its opening time"}`
        : state === "closed"
          ? `it closed at ${iso(info.closingtime) ?? "its closing time"}`
          : info.usermustwaittojoin && state !== "running"
            ? "viewers wait for a moderator to start the meeting"
            : info.userlimit > 0 && state === "running"
              ? `the meeting may be full (${info.userlimit} people at most)`
              : "your role may lack mod/bigbluebuttonbn:join there";
    throw new BigBlueButtonError(`You can't join BigBlueButton ${activityId} now: ${why}.`);
  }
  if (!info.joinurl) throw new BigBlueButtonError(`Moodle gave no join URL for BigBlueButton ${activityId}.`);
  // Moodle gives it HTML-escaped (`&amp;` between the parameters), as its template prints it.
  return new URL(decodeEntities(info.joinurl), siteUrl).href;
}

/** Runs one of update_recording's actions on a recording of the activity, checking first that the activity lists it. */
async function updateRecording(context: BrowserContext, siteUrl: string, activityId: number, recordingId: number, action: "publish" | "unpublish" | "delete") {
  const { page, facts } = await openView(context, siteUrl, activityId);
  try {
    const before = (await fetchRecordings(context, siteUrl, page, activityId, facts)).find((r) => r.id === recordingId);
    if (!before) throw new MoodleError(`BigBlueButton ${activityId} has no recording ${recordingId} you can see. Take its id from bigBlueButton().recordings.`, "not-found");
    if (action !== "delete" && before.published === (action === "publish")) return { page, facts, before, done: false };
    try {
      await callService(context, siteUrl, "mod_bigbluebuttonbn_update_recording", { bigbluebuttonbnid: facts.instanceId, recordingid: recordingId, action, additionaloptions: "{}" });
    } catch (error) {
      throw serviceError(error, activityId, `${MANAGE} and mod/bigbluebuttonbn:${action}recordings`);
    }
    return { page, facts, before, done: true };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Publishes or unpublishes a recording of a BigBlueButton activity: an unpublished recording is
 * hidden from students (listed only to those who manage recordings) and its playbacks are off. Takes
 * mod/bigbluebuttonbn:managerecordings and :publishrecordings or :unpublishrecordings. Returns the
 * recording afterwards; nothing changes when it's already so.
 */
export async function setRecordingPublished(context: BrowserContext, siteUrl: string, activityId: number, recordingId: number, published: boolean): Promise<{ changed: string; recording: BigBlueButtonRecording }> {
  const { page, facts, before, done } = await updateRecording(context, siteUrl, activityId, recordingId, published ? "publish" : "unpublish");
  try {
    if (!done) return { changed: `Recording ${recordingId} of BigBlueButton ${activityId} was already ${published ? "published" : "unpublished"}: nothing changed.`, recording: before };
    const after = (await fetchRecordings(context, siteUrl, page, activityId, facts)).find((r) => r.id === recordingId);
    if (!after || after.published !== published) throw new BigBlueButtonError(`Moodle didn't ${published ? "publish" : "unpublish"} recording ${recordingId} of BigBlueButton ${activityId}.`);
    return { changed: `${published ? "Published" : "Unpublished"} recording ${recordingId} of BigBlueButton ${activityId}.`, recording: after };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Deletes a recording of a BigBlueButton activity, on the BigBlueButton server too unless it was
 * imported (then only its link here goes). Takes mod/bigbluebuttonbn:managerecordings and :deleterecordings.
 */
export async function deleteRecording(context: BrowserContext, siteUrl: string, activityId: number, recordingId: number): Promise<{ changed: string; recordingId: number }> {
  const { page, facts } = await updateRecording(context, siteUrl, activityId, recordingId, "delete");
  try {
    const still = (await fetchRecordings(context, siteUrl, page, activityId, facts)).some((r) => r.id === recordingId);
    if (still) throw new BigBlueButtonError(`Moodle didn't delete recording ${recordingId} of BigBlueButton ${activityId}.`);
    return { changed: `Deleted recording ${recordingId} of BigBlueButton ${activityId}.`, recordingId };
  } finally {
    await page.close().catch(() => undefined);
  }
}

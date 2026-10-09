import type { BrowserContext } from "playwright-core";
import { callService } from "./ajax.js";
import { courseState } from "./course.js";
import { decodeEntities } from "./text.js";

/** One column of Moodle 5's activities overview, as `core_courseformat_get_overview_information` gives it. */
interface OverviewItem {
  key: string;
  name: string;
  contenttype: string;
  alertlabel?: string;
  alertcount?: string | number;
  contentjson?: string | null;
}

interface OverviewActivity {
  name: string;
  modname: string;
  cmid: number;
  url?: string;
  haserror?: boolean;
  items: OverviewItem[];
}

/** A column's value, whatever exporter Moodle used for it, as text plus what it carries besides. */
export interface OverviewField {
  key: string;
  label: string;
  text: string;
  date?: string;
  url?: string;
  details?: { label: string; value: string }[];
  alert?: { label: string; count: number };
}

const plain = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Reads one column: dates (humandate), plain values, dialogs with their lines, links and their alerts. */
export function overviewField(item: OverviewItem): OverviewField {
  let data: Record<string, unknown> = {};
  try {
    data = (JSON.parse(item.contentjson ?? "null") as Record<string, unknown> | null) ?? {};
  } catch {
    // An exporter Moodle may add later: the label alone.
  }
  const type = item.contenttype.split("\\").pop() ?? "";
  const field: OverviewField = { key: item.key, label: decodeEntities(item.name), text: "" };
  if (type === "humandate" && typeof data.timestamp === "number") {
    field.date = new Date(data.timestamp * 1000).toISOString();
    field.text = [data.date, data.time].filter(Boolean).join(" ");
  } else if (type === "pix_icon") {
    // A mark (answered, submitted…): what it means is in its alt text.
    const extras = (data.extras as { name: string; value: string }[] | undefined) ?? [];
    field.text = decodeEntities(extras.find((e) => e.name === "alt")?.value ?? extras.find((e) => e.name === "title")?.value ?? "");
  } else if (type === "overviewdialog") {
    field.text = plain(String(data.buttoncontent ?? ""));
    const items = (data.items as { label: string; value: string }[] | undefined) ?? [];
    if (items.length > 0) field.details = items.map((i) => ({ label: plain(i.label), value: plain(String(i.value)) }));
  } else {
    field.text = plain(String(data.content ?? data.value ?? ""));
    if (typeof data.linkurl === "string") field.url = data.linkurl;
  }
  if (item.alertlabel) field.alert = { label: decodeEntities(item.alertlabel), count: Number(item.alertcount ?? 0) };
  return field;
}

/**
 * Moodle 5's activities overview of a course for one type ("resource" for every resource type):
 * per activity, the columns its overview page shows the person (due dates, submissions, what needs
 * grading, their own grade…). Without a type, every type in the course's state: "resource" first,
 * which brings pages, books, files, folders and links at once, then each type still missing.
 */
export async function activitiesOverview(context: BrowserContext, siteUrl: string, courseId: number, type?: string) {
  let types = type ? [type] : [];
  let cmsByType = new Map<string, number[]>();
  if (!type) {
    const state = await courseState(context, siteUrl, courseId);
    cmsByType = new Map();
    for (const cm of state.cm) cmsByType.set(cm.module, [...(cmsByType.get(cm.module) ?? []), Number(cm.id)]);
    types = ["resource", ...cmsByType.keys()];
  }
  const activities = [];
  const seen = new Set<number>();
  for (const modname of types) {
    // Every activity of this type came with an earlier answer ("resource").
    if (!type && modname !== "resource" && (cmsByType.get(modname) ?? []).every((id) => seen.has(id))) continue;
    let answer: { activities: OverviewActivity[] };
    try {
      answer = await callService(context, siteUrl, "core_courseformat_get_overview_information", { courseid: courseId, modname });
    } catch (error) {
      // A type without an overview (labels, some plugins) is left out when listing them all.
      if (type) throw error;
      continue;
    }
    for (const activity of answer.activities) {
      if (seen.has(activity.cmid)) continue;
      seen.add(activity.cmid);
      const name = activity.items.find((i) => i.key === "name");
      const nameData = (JSON.parse(name?.contentjson ?? "{}") as { hidden?: boolean; available?: boolean }) ?? {};
      activities.push({
        id: activity.cmid,
        name: decodeEntities(activity.name),
        type: activity.modname,
        ...(activity.url ? { url: activity.url } : {}),
        visible: !nameData.hidden,
        ...(nameData.available === false ? { available: false } : {}),
        fields: activity.items.filter((i) => i.key !== "name").map(overviewField),
      });
    }
  }
  return activities;
}

/** A calendar action event: something the person has to do by a date. */
interface ActionEvent {
  name: string;
  activityname?: string;
  modulename?: string;
  eventtype: string;
  timesort: number;
  overdue?: boolean;
  url?: string;
  course?: { id: number; shortname?: string };
  action?: { name: string; url?: string; itemcount?: number; actionable?: boolean };
}

/**
 * What the person has to do by a date (calendar action events: submit, attempt, grade…), from the
 * last `pastDays` to `days` ahead, in one course or all. Teachers' grading counts come from the
 * activities overview instead: Moodle gives them few action events.
 */
export async function deadlines(context: BrowserContext, siteUrl: string, { courseId, days = 30, pastDays = 7 }: { courseId?: number; days?: number; pastDays?: number }) {
  const now = Math.floor(Date.now() / 1000);
  const window = { timesortfrom: now - pastDays * 86400, timesortto: now + days * 86400, limitnum: 50 };
  const { events } = courseId
    ? await callService<{ events: ActionEvent[] }>(context, siteUrl, "core_calendar_get_action_events_by_course", { courseid: courseId, ...window })
    : await callService<{ events: ActionEvent[] }>(context, siteUrl, "core_calendar_get_action_events_by_timesort", window);
  return events.map((event) => {
    const activityId = event.url ? Number(new URL(event.url).searchParams.get("id")) || undefined : undefined;
    return {
      ...(activityId ? { activityId } : {}),
      activity: decodeEntities(event.activityname ?? event.name),
      ...(event.modulename ? { type: event.modulename } : {}),
      event: decodeEntities(event.name),
      kind: event.eventtype,
      date: new Date(event.timesort * 1000).toISOString(),
      overdue: event.overdue === true,
      ...(event.course ? { course: { id: event.course.id, ...(event.course.shortname ? { shortname: decodeEntities(event.course.shortname) } : {}) } } : {}),
      ...(event.action ? { action: { name: decodeEntities(event.action.name), actionable: event.action.actionable !== false, ...(event.action.itemcount ? { count: event.action.itemcount } : {}), ...(event.action.url ? { url: event.action.url } : {}) } } : {}),
    };
  });
}

/** What changed in a course's activities since a date, with their names from the course's state. */
export async function courseUpdates(context: BrowserContext, siteUrl: string, courseId: number, since: Date) {
  // One after the other: the first call may have to open the kept service tab.
  const { instances } = await callService<{ instances: { contextlevel: string; id: number; updates: { name: string; timeupdated?: number; itemids?: number[] }[] }[] }>(context, siteUrl, "core_course_get_updates_since", {
    courseid: courseId,
    since: Math.floor(since.getTime() / 1000),
  });
  const state = await courseState(context, siteUrl, courseId);
  const byId = new Map(state.cm.map((cm) => [Number(cm.id), cm]));
  return instances
    .filter((instance) => instance.contextlevel === "module")
    .map((instance) => {
      const cm = byId.get(instance.id);
      return {
        id: instance.id,
        ...(cm ? { name: decodeEntities(cm.name), type: cm.module } : {}),
        changes: instance.updates.map((u) => ({ what: u.name, ...(u.timeupdated ? { time: new Date(u.timeupdated * 1000).toISOString() } : {}), ...(u.itemids ? { items: u.itemids.length } : {}) })),
      };
    });
}

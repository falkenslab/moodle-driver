import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CalendarError, MoodleError, calendarEvent, createEvent, deleteEvent, updateEvent, upcomingEvents } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** The calendar's event form as Moodle 5.2 renders it, reduced; course events offered only to a teacher. */
const form = (types: string[]) => `<form class="mform"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__core_calendar_local_event_forms_create" value="1">
<input name="name"><select name="eventtype">${types.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
<select name="courseid"><option value="3">Course 3</option></select>
<input type="radio" name="duration" value="0" checked><input type="radio" name="duration" value="1"><input type="radio" name="duration" value="2"><input name="timedurationminutes">
<textarea name="description[text]"></textarea><input type="hidden" name="description[format]" value="1"></form>`;

function fakeCalendar(types = ["user", "course"]): FakeMoodleState {
  const events: { id: number; name: string; eventtype: string; timestart: number; timeduration: number; course: { id: number } }[] = [];
  return {
    user: { id: 3, fullName: "Teacher" },
    serviceCalls: [],
    services: {
      core_get_fragment: () => ({ html: form(types), javascript: "" }),
      core_calendar_submit_create_update_form: ({ formdata }) => {
        const data = new URLSearchParams(String(formdata));
        if (!data.get("name")) return { validationerror: true };
        const event = { id: 12, name: data.get("name")!, eventtype: data.get("eventtype")!, timestart: 1_792_000_000, timeduration: data.get("duration") === "2" ? Number(data.get("timedurationminutes")) * 60 : 0, course: { id: Number(data.get("courseid")) } };
        events.push(event);
        return { event, validationerror: false };
      },
      core_calendar_get_calendar_upcoming_view: () => ({ events }),
      core_calendar_delete_calendar_events: (args) => {
        const [toDelete] = args.events as { eventid: number }[];
        const at = events.findIndex((e) => e.id === toDelete!.eventid);
        if (at < 0) throw new ServiceFailure("invalidrecordunknown");
        events.splice(at, 1);
        return null;
      },
    },
  };
}

describe("calendar events", { skip: !browser && "no system browser" }, () => {
  it("creates a course event with the form opened at its start, lists it, and deletes it", async () => {
    const state = fakeCalendar();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    const start = new Date(1_792_000_000_000);
    const created = await createEvent(context, SITE, { courseId: 3, name: "Tutorial", start, durationMinutes: 45, description: "<p>Room 3</p>" });
    assert.deepEqual(created.event, { id: 12, name: "Tutorial", type: "course", start: start.toISOString(), durationMinutes: 45, courseId: 3 });
    const fragment = state.serviceCalls!.find((c) => c.methodname === "core_get_fragment")!;
    assert.deepEqual(fragment.args.args, [
      { name: "courseid", value: "3" },
      { name: "starttime", value: "1792000000" },
    ]);
    const sent = new URLSearchParams(String(state.serviceCalls!.find((c) => c.methodname === "core_calendar_submit_create_update_form")!.args.formdata));
    assert.deepEqual([sent.get("eventtype"), sent.get("duration"), sent.get("description[text]")], ["course", "2", "<p>Room 3</p>"]);
    assert.deepEqual((await upcomingEvents(context, SITE, { courseId: 3 })).map((e) => e.id), [12]);
    await deleteEvent(context, SITE, 12);
    assert.deepEqual(await upcomingEvents(context, SITE), []);
    await assert.rejects(deleteEvent(context, SITE, 12), (error: Error) => error instanceof CalendarError && /no calendar event 12/.test(error.message));
    await context.close();
  });

  it("refuses a course the person can't add events to", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, fakeCalendar(["user"]));
    await assert.rejects(createEvent(context, SITE, { courseId: 3, name: "No", start: new Date() }), /can't add events to course 3/);
    await context.close();
  });
});

/** A date selector's fields as the form renders them, reduced to inputs; made up. */
const selector = (name: string, [day, month, year, hour, minute]: number[]) =>
  Object.entries({ day, month, year, hour, minute })
    .map(([part, value]) => `<input name="${name}[${part}]" value="${value}">`)
    .join("");

/**
 * The calendar's update form for a course event, as Moodle 5.2 renders it, reduced: its group
 * select holds groups with none selected, its length kept as an end ("until"); a repeated event's
 * asks whether to change the whole series.
 */
const updateForm = (id: number, repeated: boolean) => `<form class="mform"><input type="hidden" name="id" value="${id}"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__core_calendar_local_event_forms_update" value="1">
<input name="name" value="Tutorial"><select name="eventtype"><option value="user">user</option><option value="course" selected>course</option></select>
<select name="courseid"><option value="3" selected>Course 3</option></select><select name="groupcourseid"></select><select name="groupid"><option value="4">Group 4</option></select>
${selector("timestart", [4, 11, 2026, 17, 0])}
<input type="radio" name="duration" value="0"><input type="radio" name="duration" value="1" checked>${selector("timedurationuntil", [4, 11, 2026, 17, 45])}<input type="radio" name="duration" value="2"><input name="timedurationminutes" value="">
${repeated ? '<input type="radio" name="repeateditall" value="1" checked><input type="radio" name="repeateditall" value="0">' : ""}
<textarea name="description[text]">&lt;p&gt;Room 3&lt;/p&gt;</textarea><input name="location" value="Room 3"></form>`;

function fakeUpdates(): FakeMoodleState {
  const event = (id: number) => ({ id, name: "Tutorial", eventtype: "course", timestart: 1_793_808_000, timeduration: 2700, course: { id: 3 } });
  return {
    user: { id: 3, fullName: "Teacher" },
    serviceCalls: [],
    services: {
      // A missing event answers "nopermissions", as Moodle 5.2 does.
      core_calendar_get_calendar_event_by_id: ({ eventid }) => {
        if (![19, 30, 40].includes(Number(eventid))) throw new ServiceFailure("nopermissions");
        return { event: event(Number(eventid)) };
      },
      core_get_fragment: ({ args }) => {
        const id = Number((args as { name: string; value: string }[]).find((a) => a.name === "eventid")?.value);
        if (id === 40) throw new ServiceFailure("nopermissiontoupdatecalendar");
        return { html: updateForm(id, id === 30), javascript: "" };
      },
      core_calendar_submit_create_update_form: ({ formdata }) => {
        const data = new URLSearchParams(String(formdata));
        if (data.get("duration") === "1" && Number(data.get("timedurationuntil[day]")) < Number(data.get("timestart[day]"))) return { validationerror: true };
        return { event: { ...event(Number(data.get("id"))), name: data.get("name") }, validationerror: false };
      },
    },
  };
}

/** The form data the last update sent. */
const sentForm = (state: FakeMoodleState) =>
  new URLSearchParams(String(state.serviceCalls!.filter((c) => c.methodname === "core_calendar_submit_create_update_form").at(-1)!.args.formdata));

describe("calendarEvent and updateEvent", { skip: !browser && "no system browser" }, () => {
  it("reads one event, and changes only what's given, a new start keeping its length", async () => {
    const state = fakeUpdates();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    assert.deepEqual(await calendarEvent(context, SITE, 19), { id: 19, name: "Tutorial", type: "course", start: "2026-11-04T16:00:00.000Z", durationMinutes: 45, courseId: 3 });
    const result = await updateEvent(context, SITE, 19, { name: "Tutorial (moved)", start: new Date("2026-10-15T09:30:00Z") });
    assert.equal(result.changed, 'Event 19 "Tutorial (moved)" changed (name, start).');
    const sent = sentForm(state);
    // The person's time zone (the fake's, Europe/Madrid) is UTC+2 that day.
    assert.deepEqual(
      ["timestart[day]", "timestart[month]", "timestart[year]", "timestart[hour]", "timestart[minute]"].map((name) => sent.get(name)),
      ["15", "10", "2026", "11", "30"],
    );
    assert.deepEqual([sent.get("duration"), sent.get("timedurationminutes"), sent.get("location"), sent.get("description[text]")], ["2", "45", "Room 3", "<p>Room 3</p>"]);
    // A course event takes no group: the group select's first group would hide it from everyone else.
    assert.deepEqual([sent.get("courseid"), sent.has("groupid"), sent.has("groupcourseid")], ["3", false, false]);
    await context.close();
  });

  it("sets a length as an end or in minutes, and a series' option where Moodle asks it", async () => {
    const state = fakeUpdates();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    await updateEvent(context, SITE, 19, { until: new Date("2026-11-04T18:00:00Z"), location: "Room 4" });
    assert.deepEqual([sentForm(state).get("duration"), sentForm(state).get("timedurationuntil[hour]"), sentForm(state).get("location")], ["1", "19", "Room 4"]);
    await updateEvent(context, SITE, 19, { durationMinutes: 0, wholeSeries: false });
    assert.deepEqual([sentForm(state).get("duration"), sentForm(state).has("repeateditall")], ["0", false]);
    await updateEvent(context, SITE, 30, { name: "Only this one", wholeSeries: false });
    assert.equal(sentForm(state).get("repeateditall"), "0");
    await assert.rejects(updateEvent(context, SITE, 19, { durationMinutes: 30, until: new Date() }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    await context.close();
  });

  it("explains a missing event, one the person can't change, and Moodle's refusal; changes nothing when nothing is given", async () => {
    const state = fakeUpdates();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    await assert.rejects(calendarEvent(context, SITE, 99), (error: Error) => error instanceof CalendarError && /no calendar event 99/.test(error.message));
    await assert.rejects(updateEvent(context, SITE, 99, { name: "x" }), CalendarError);
    await assert.rejects(updateEvent(context, SITE, 40, { name: "x" }), (error: Error) => error instanceof CalendarError && /can't change calendar event 40/.test(error.message));
    await assert.rejects(updateEvent(context, SITE, 19, { until: new Date("2026-11-01T10:00:00Z") }), (error: Error) => error instanceof CalendarError && /refused the changes to event 19/.test(error.message));
    const before = state.serviceCalls!.length;
    assert.equal((await updateEvent(context, SITE, 19, {})).changed, "Nothing to change.");
    assert.equal(state.serviceCalls!.filter((c, i) => i >= before && c.methodname !== "core_calendar_get_calendar_event_by_id").length, 0);
    await context.close();
  });
});

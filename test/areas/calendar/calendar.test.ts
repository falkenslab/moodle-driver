import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CalendarError, createEvent, deleteEvent, upcomingEvents } from "../../../src/index.js";
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

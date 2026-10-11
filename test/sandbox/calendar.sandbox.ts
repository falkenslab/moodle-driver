// The calendar against the sandbox: a course event made, read, changed and deleted on the scratch
// course by the teacher, seen by the student; course 3's upcoming events only read.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { CalendarError, type CalendarEvent } from "../../src/index.js";
import { COURSE, as, cleanup, quietly, scratchCourse, type ScratchCourse } from "./harness.js";
import { warmUp } from "./warm-up.js";

before(() => warmUp("admin", "teacher", "student"));

/** A start in a few days, on the minute: the event form keeps minutes, not seconds. */
function daysAhead(days: number, hour = 10): Date {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

describe("calendar", () => {
  let course: ScratchCourse;
  let event: CalendarEvent;

  before(async () => {
    course = await scratchCourse("calendar");
  });

  it("upcomingEvents: the student's upcoming events in the content course and in all", async () => {
    const student = await as("student");
    const inCourse = await student.upcomingEvents({ courseId: COURSE });
    for (const found of inCourse) {
      assert.ok(found.id > 0 && found.name && !Number.isNaN(Date.parse(found.start)));
      if (found.courseId !== undefined) assert.equal(found.courseId, COURSE);
    }
    const all = await student.upcomingEvents();
    const ids = new Set(all.map((e) => e.id));
    // The site-wide view includes the course's.
    for (const found of inCourse) assert.ok(ids.has(found.id), `event ${found.id} of course ${COURSE} is missing from all the upcoming events`);
  });

  it("createEvent: a course event in the scratch course, seen by the student", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const start = daysAhead(3);
    const result = await teacher.createEvent({ courseId: course.id, name: "Driver check suite event", start, durationMinutes: 45, description: "<p>Made by the sandbox suite.</p>" });
    event = result.event;
    cleanup(() => quietly(() => teacher.deleteEvent(event.id)));
    assert.match(result.changed, /added/);
    assert.equal(event.name, "Driver check suite event");
    assert.equal(event.type, "course");
    assert.equal(event.courseId, course.id);
    assert.equal(event.start, start.toISOString());
    assert.equal(event.durationMinutes, 45);
    const seen = await (await as("student")).upcomingEvents({ courseId: course.id });
    assert.ok(seen.some((e) => e.id === event.id && e.name === "Driver check suite event"));
  });

  it("createEvent: the student can't add to the course's calendar", async () => {
    const student = await as("student");
    await assert.rejects(student.createEvent({ courseId: course.id, name: "Driver check suite refused", start: daysAhead(4) }), CalendarError);
    const seen = await (await as("teacher")).upcomingEvents({ courseId: course.id });
    assert.ok(!seen.some((e) => e.name === "Driver check suite refused"));
  });

  it("calendarEvent: the event by its id, as the student sees it", async () => {
    const found = await (await as("student")).calendarEvent(event.id);
    assert.deepEqual(found, event);
  });

  it("updateEvent: a new name and start keep the length; then a new length", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const start = daysAhead(5, 14);
    const renamed = await teacher.updateEvent(event.id, { name: "Driver check suite event (moved)", start, location: "Room 1" });
    assert.equal(renamed.event.name, "Driver check suite event (moved)");
    assert.equal(renamed.event.start, start.toISOString());
    assert.equal(renamed.event.durationMinutes, 45);
    const longer = await teacher.updateEvent(event.id, { durationMinutes: 90 });
    assert.equal(longer.event.durationMinutes, 90);
    const read = await (await as("student")).calendarEvent(event.id);
    assert.equal(read.name, "Driver check suite event (moved)");
    assert.equal(read.start, start.toISOString());
    assert.equal(read.durationMinutes, 90);
    await assert.rejects((await as("student")).updateEvent(event.id, { name: "Driver check suite hijacked" }), CalendarError);
  });

  it("deleteEvent: the event is gone, and deleting it again says so", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const result = await teacher.deleteEvent(event.id);
    assert.match(result.changed, /deleted/);
    await assert.rejects(teacher.calendarEvent(event.id), CalendarError);
    assert.ok(!(await teacher.upcomingEvents({ courseId: course.id })).some((e) => e.id === event.id));
    await assert.rejects(teacher.deleteEvent(event.id), CalendarError);
  });
});

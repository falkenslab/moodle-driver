// Participants, enrolments, groups, groupings and enrolment methods, against the sandbox: reads on
// the content course, writes on the scratch course. The user enrolled and unenrolled is another
// seeded student, not in the scratch course; everything made is removed by the test that made it.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { EnrolmentError, FormError, MoodleError, NoParticipantsError, NoteError } from "../../src/index.js";
import { COURSE, as, cleanup, quietly, scratchCourse, userId, type ScratchCourse } from "./harness.js";

const STUDENT_ROLE = 5;
const EDITING_TEACHER_ROLE = 3;
const TEACHER_ROLE = 4;
/** A course id the sandbox doesn't have. */
const NO_COURSE = 999_999;
const stamp = Date.now().toString(36);
/** The sandbox is shared and slow: page-heavy tests get a quarter of an hour. */
const SLOW = { timeout: 900_000 };

describe("participants and groups", () => {
  let scratch: ScratchCourse;
  let studentId: number;
  let teacherId: number;
  /** Another seeded student, found in the scratch course's "Enrol users" search. */
  let otherId: number;

  before(async () => {
    scratch = await scratchCourse("participants");
    studentId = await userId("student");
    teacherId = await userId("teacher");
  });

  it("participantFilters: the content course's roles, as its teacher filters by them", async () => {
    const teacher = await as("teacher");
    const { roles, groups } = await teacher.participantFilters(COURSE);
    assert.ok(roles.some((role) => role.id === STUDENT_ROLE));
    assert.ok(roles.some((role) => role.id === EDITING_TEACHER_ROLE));
    assert.ok(Array.isArray(groups));
    await assert.rejects(teacher.participantFilters(NO_COURSE), NoParticipantsError);
  });

  it("participants: the content course's student and teacher with their roles, and the role filter", async () => {
    const teacher = await as("teacher");
    const everyone = await teacher.participants(COURSE);
    const student = everyone.find((p) => p.userId === studentId);
    assert.ok(student, "the student is a participant of the content course");
    assert.ok(student.fullName);
    assert.deepEqual(
      student.roles.map((r) => r.id),
      [STUDENT_ROLE],
    );
    assert.ok(everyone.find((p) => p.userId === teacherId)?.roles.some((r) => r.id === EDITING_TEACHER_ROLE));
    const students = await teacher.participants(COURSE, { role: STUDENT_ROLE });
    assert.ok(students.some((p) => p.userId === studentId));
    assert.ok(!students.some((p) => p.userId === teacherId));
    assert.ok(students.length < everyone.length);
    // Nobody accessed the course since tomorrow; the student and the teacher have since 2001.
    const inactiveSinceTomorrow = await teacher.participants(COURSE, { inactiveSince: new Date(Date.now() + 86_400_000) });
    assert.equal(inactiveSinceTomorrow.length, everyone.length);
    const inactiveSince2001 = await teacher.participants(COURSE, { inactiveSince: new Date("2001-01-01T00:00:00Z") });
    assert.ok(!inactiveSince2001.some((p) => p.userId === studentId || p.userId === teacherId));
    await assert.rejects(teacher.participants(NO_COURSE), NoParticipantsError);
  });

  it("potentialUsers: another seeded student can be enrolled in the scratch course, its participants can't", async () => {
    const teacher = await as("teacher");
    const found = await teacher.potentialUsers(scratch.id, "Marcos");
    const marcos = found.find((u) => /marcos/i.test(u.fullName));
    assert.ok(marcos, `"Marcos" is among the users the teacher may enrol: ${JSON.stringify(found)}`);
    otherId = marcos.userId;
    const all = await teacher.potentialUsers(scratch.id);
    assert.ok(all.some((u) => u.userId === otherId));
    assert.ok(!all.some((u) => u.userId === studentId), "an enrolled student isn't offered");
    await assert.rejects((await as("student")).potentialUsers(scratch.id), EnrolmentError);
  });

  it("enrolUsers: the teacher enrols another student in the scratch course", SLOW, async () => {
    assert.ok(otherId, "potentialUsers found the user to enrol");
    const teacher = await as("teacher");
    cleanup(() => quietly(async () => (await as("admin")).unenrolUser(scratch.id, otherId)));
    const result = await teacher.enrolUsers(scratch.id, [otherId], { roleId: STUDENT_ROLE });
    assert.equal(result.count, 1);
    assert.equal(result.roleId, STUDENT_ROLE);
    const enrolled = (await teacher.participants(scratch.id)).find((p) => p.userId === otherId);
    assert.deepEqual(
      enrolled?.roles.map((r) => r.id),
      [STUDENT_ROLE],
    );
    await assert.rejects(teacher.enrolUsers(scratch.id, []), EnrolmentError);
    await assert.rejects((await as("student")).enrolUsers(scratch.id, [otherId]), EnrolmentError);
  });

  it("setUserRoles: the teacher makes the enrolled student a non-editing teacher, then a student again", SLOW, async () => {
    assert.ok(otherId, "potentialUsers found the user");
    const teacher = await as("teacher");
    const changed = await teacher.setUserRoles(scratch.id, otherId, [TEACHER_ROLE]);
    assert.deepEqual(changed.roleIds, [TEACHER_ROLE]);
    assert.deepEqual(
      (await teacher.participants(scratch.id)).find((p) => p.userId === otherId)?.roles.map((r) => r.id),
      [TEACHER_ROLE],
    );
    const back = await teacher.setUserRoles(scratch.id, otherId, [STUDENT_ROLE]);
    assert.deepEqual(back.roleIds, [STUDENT_ROLE]);
    // The student may not assign roles.
    await assert.rejects((await as("student")).setUserRoles(scratch.id, otherId, [TEACHER_ROLE]), EnrolmentError);
  });

  it("createGroup: a group in the scratch course, read back by the participants page", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Suite group ${stamp}`, idNumber: `suite-${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    const listed = (await teacher.groups(scratch.id)).find((g) => g.id === groupId);
    assert.equal(listed?.name, `Suite group ${stamp}`);
    assert.deepEqual(listed?.members, []);
  });

  it("updateGroup: renames a group of the scratch course", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Rename me ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    await teacher.updateGroup(groupId, { name: `Renamed ${stamp}`, description: "<p>Changed by the suite</p>" });
    assert.equal((await teacher.groups(scratch.id)).find((g) => g.id === groupId)?.name, `Renamed ${stamp}`);
  });

  it("setGroupMembers: adds and removes the scratch course's student", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Members ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    const added = await teacher.setGroupMembers(groupId, { add: [studentId] });
    assert.deepEqual(added.members, [studentId]);
    // Moodle sees it: the participants page puts the student in the group.
    const student = (await teacher.participants(scratch.id)).find((p) => p.userId === studentId);
    assert.ok(student?.groups.some((g) => g.id === groupId));
    assert.deepEqual((await teacher.participants(scratch.id, { group: groupId })).map((p) => p.userId), [studentId]);
    const removed = await teacher.setGroupMembers(groupId, { remove: [studentId] });
    assert.deepEqual(removed.members, []);
  });

  it("groups: the scratch course's groups with their members", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Listed ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    await teacher.setGroupMembers(groupId, { add: [studentId, teacherId] });
    const listed = (await teacher.groups(scratch.id)).find((g) => g.id === groupId);
    assert.deepEqual([...(listed?.members ?? [])].sort((a, b) => a - b), [studentId, teacherId].sort((a, b) => a - b));
    // The student sees it too: the course has no separate groups.
    assert.ok((await (await as("student")).groups(scratch.id)).some((g) => g.id === groupId));
  });

  it("deleteGroup: the group is gone, its members stay in the course", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Delete me ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    await teacher.setGroupMembers(groupId, { add: [studentId] });
    await teacher.deleteGroup(groupId);
    assert.ok(!(await teacher.groups(scratch.id)).some((g) => g.id === groupId));
    assert.ok((await teacher.participants(scratch.id)).some((p) => p.userId === studentId));
  });

  it("createGrouping: a grouping in the scratch course, listed by groupings", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupingId } = await teacher.createGrouping(scratch.id, { name: `Suite grouping ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGrouping(groupingId)));
    const listed = (await teacher.groupings(scratch.id)).find((g) => g.id === groupingId);
    assert.equal(listed?.name, `Suite grouping ${stamp}`);
    assert.deepEqual(listed?.groupIds, []);
  });

  it("setGroupingGroups: a grouping's groups set, then emptied", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `In grouping ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    const { groupingId } = await teacher.createGrouping(scratch.id, { name: `With groups ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGrouping(groupingId)));
    const set = await teacher.setGroupingGroups(groupingId, [groupId]);
    assert.deepEqual(set.groupIds, [groupId]);
    assert.deepEqual((await teacher.groupings(scratch.id)).find((g) => g.id === groupingId)?.groupIds, [groupId]);
    const emptied = await teacher.setGroupingGroups(groupingId, []);
    assert.deepEqual(emptied.groupIds, []);
  });

  it("groupings: the scratch course's groupings as the teacher sees them", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupingId } = await teacher.createGrouping(scratch.id, { name: `Seen ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGrouping(groupingId)));
    assert.ok((await teacher.groupings(scratch.id)).some((g) => g.id === groupingId && g.name === `Seen ${stamp}`));
    // The student can't manage groupings.
    await assert.rejects((await as("student")).groupings(scratch.id));
  });

  it("deleteGrouping: the grouping is gone, its groups stay", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Survives ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    const { groupingId } = await teacher.createGrouping(scratch.id, { name: `Delete me ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGrouping(groupingId)));
    await teacher.setGroupingGroups(groupingId, [groupId]);
    await teacher.deleteGrouping(groupingId);
    assert.ok(!(await teacher.groupings(scratch.id)).some((g) => g.id === groupingId));
    assert.ok((await teacher.groups(scratch.id)).some((g) => g.id === groupId));
  });

  it("autoCreateGroups: the scratch course's students in two groups of a new grouping, previewed first, then created", SLOW, async () => {
    const teacher = await as("teacher");
    const admin = await as("admin");
    // Two more of the sandbox's users, enrolled as students (Marcos is the one the other tests enrol and unenrol).
    const offered = await admin.potentialUsers(scratch.id);
    const extra = offered.filter((u) => !/marcos/i.test(u.fullName)).slice(0, 2).map((u) => u.userId);
    assert.equal(extra.length, 2, `two users besides Marcos can be enrolled: ${JSON.stringify(offered.map((u) => u.fullName))}`);
    cleanup(() => quietly(async () => {
      for (const id of extra) await admin.unenrolUser(scratch.id, id);
    }));
    await admin.enrolUsers(scratch.id, extra, { roleId: STUDENT_ROLE });
    const students = await teacher.participants(scratch.id, { role: STUDENT_ROLE });
    // The student and these two, and Marcos when the enrolUsers check ran before.
    assert.ok(students.length >= 3);
    const options = { by: "groups" as const, count: 2, naming: `Driver check auto ${stamp} @`, allocation: "random" as const, roleId: STUDENT_ROLE, newGrouping: `Driver check auto ${stamp}` };

    const preview = await teacher.autoCreateGroups(scratch.id, { ...options, preview: true });
    assert.deepEqual(preview.groups.map((g) => [g.name, g.nameTaken]), [[`Driver check auto ${stamp} A`, false], [`Driver check auto ${stamp} B`, false]]);
    assert.deepEqual(preview.groups.flatMap((g) => g.members).sort(), students.map((s) => s.fullName).sort());
    assert.ok(!(await teacher.groups(scratch.id)).some((g) => g.name.startsWith(`Driver check auto ${stamp}`)), "a preview creates nothing");

    const created = await teacher.autoCreateGroups(scratch.id, { ...options, seed: preview.seed });
    for (const group of created.groups) cleanup(() => quietly(() => teacher.deleteGroup(group.id)));
    if (created.groupingId) cleanup(() => quietly(() => teacher.deleteGrouping(created.groupingId!)));
    assert.deepEqual(created.groups.map((g) => g.name), preview.groups.map((g) => g.name));
    // The same seed, the same groups: each created group has the members its preview showed.
    const nameOf = new Map(students.map((s) => [s.userId, s.fullName]));
    assert.deepEqual(created.groups.map((g) => g.members.map((id) => nameOf.get(id)).sort()), preview.groups.map((g) => [...g.members].sort()));
    const listed = await teacher.groups(scratch.id);
    for (const group of created.groups) assert.deepEqual([...(listed.find((g) => g.id === group.id)?.members ?? [])].sort(), [...group.members].sort());
    assert.ok(created.groupingId);
    assert.deepEqual([...((await teacher.groupings(scratch.id)).find((g) => g.id === created.groupingId)?.groupIds ?? [])].sort(), created.groups.map((g) => g.id).sort());

    // What the form refuses: the same names again, a scheme without # or @, a role it doesn't offer; and a student.
    await assert.rejects(teacher.autoCreateGroups(scratch.id, { ...options, newGrouping: undefined, preview: true }), (e: Error) => e instanceof FormError && /namingscheme/.test(e.message));
    await assert.rejects(teacher.autoCreateGroups(scratch.id, { ...options, naming: "Driver check plain", newGrouping: undefined }), (e: Error) => e instanceof FormError && /namingscheme/.test(e.message));
    await assert.rejects(teacher.autoCreateGroups(scratch.id, { ...options, roleId: 999 }), (e: Error) => e instanceof MoodleError && e.code === "invalid-input");
    await assert.rejects((await as("student")).autoCreateGroups(scratch.id, options), (e: Error) => e instanceof MoodleError && e.code === "not-available" && /moodle\/course:managegroups/.test(e.message));
  });

  it("importGroups: two groups from a CSV, a third already in the course skipped", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Driver check taken ${stamp}` });
    cleanup(() => quietly(() => teacher.deleteGroup(groupId)));
    const dir = await mkdtemp(path.join(tmpdir(), "groups-"));
    const file = path.join(dir, "groups.csv");
    await writeFile(file, `groupname,description\nDriver check csv ${stamp} 1,First\nDriver check csv ${stamp} 2,Second\nDriver check taken ${stamp},Again\n`);
    const result = await teacher.importGroups(scratch.id, file);
    for (const group of result.groups) cleanup(() => quietly(() => teacher.deleteGroup(group.id)));
    assert.deepEqual(result.groups.map((g) => g.name).sort(), [`Driver check csv ${stamp} 1`, `Driver check csv ${stamp} 2`]);
    assert.equal(result.problems.length, 1);
    assert.ok(result.problems[0]!.includes(`Driver check taken ${stamp}`) && !/Dismiss/.test(result.problems[0]!), result.problems[0]);
    const listed = await teacher.groups(scratch.id);
    for (const group of result.groups) assert.ok(listed.some((g) => g.id === group.id));
    await writeFile(file, "name\nDriver check wrong column\n");
    await assert.rejects(teacher.importGroups(scratch.id, file), (e: Error) => e instanceof MoodleError && e.code === "invalid-input");
    await assert.rejects((await as("student")).importGroups(scratch.id, file), (e: Error) => e instanceof MoodleError && e.code === "not-available");
  });

  it("enrolmentMethods: the scratch course's manual enrolment, with its users", SLOW, async () => {
    const teacher = await as("teacher");
    const methods = await teacher.enrolmentMethods(scratch.id);
    const manual = methods.find((m) => m.type === "manual");
    assert.ok(manual, `the scratch course has manual enrolment: ${JSON.stringify(methods)}`);
    assert.equal(manual.enabled, true);
    // The teacher and the student, and the other student while enrolled.
    assert.ok(manual.users >= 2);
    // An editing teacher can't open manual enrolment's form (enrol/manual:config): its role comes to the admin.
    assert.equal(manual.roleId, undefined);
    assert.equal((await (await as("admin")).enrolmentMethods(scratch.id)).find((m) => m.id === manual.id)?.roleId, STUDENT_ROLE);
    await assert.rejects((await as("student")).enrolmentMethods(scratch.id), EnrolmentError);
  });

  it("setEnrolmentMethod: self enrolment enabled with a key and a limit, then disabled", SLOW, async () => {
    const teacher = await as("teacher");
    const { method } = await teacher.setEnrolmentMethod(scratch.id, { type: "self" }, { enabled: true, key: `key-${stamp}`, maxUsers: 7 });
    assert.equal(method.type, "self");
    assert.equal(method.enabled, true);
    assert.equal(method.hasKey, true);
    assert.equal(method.maxUsers, 7);
    const read = (await teacher.enrolmentMethods(scratch.id)).find((m) => m.id === method.id);
    assert.equal(read?.enabled, true);
    assert.equal(read?.maxUsers, 7);
    const off = await teacher.setEnrolmentMethod(scratch.id, method.id, { enabled: false, key: "", maxUsers: 0 });
    assert.equal(off.method.enabled, false);
    assert.equal(off.method.hasKey, false);
    assert.equal(off.method.maxUsers, undefined);
    await assert.rejects(teacher.setEnrolmentMethod(scratch.id, NO_COURSE, { enabled: true }), EnrolmentError);
  });

  it("setEnrolmentMethod: manual, self and guest disabled and enabled again by whom Moodle lets, read back with enrolmentMethods", SLOW, async () => {
    const teacher = await as("teacher");
    const admin = await as("admin");
    const original = await admin.enrolmentMethods(scratch.id);
    // Whatever happens, each method ends as it was.
    cleanup(() => quietly(async () => {
      for (const m of original) await admin.setEnrolmentMethod(scratch.id, m.id, { enabled: m.enabled });
    }));
    const state = async (id: number) => (await admin.enrolmentMethods(scratch.id)).find((m) => m.id === id)?.enabled;
    for (const type of ["manual", "self", "guest"]) {
      const method = original.find((m) => m.type === type);
      assert.ok(method, `the scratch course has a ${type} method: ${JSON.stringify(original)}`);
      // The admin switches every one; the editing teacher self enrolment and guest access only (enrol/manual:config).
      const switchers = type === "manual" ? [admin] : [admin, teacher];
      for (const moodle of switchers) {
        const flipped = await moodle.setEnrolmentMethod(scratch.id, method.id, { enabled: !method.enabled });
        assert.equal(flipped.method.enabled, !method.enabled, `${type} switched`);
        assert.equal(await state(method.id), !method.enabled);
        const back = await moodle.setEnrolmentMethod(scratch.id, { type }, { enabled: method.enabled });
        assert.equal(back.method.enabled, method.enabled, `${type} switched back`);
        assert.equal(await state(method.id), method.enabled);
      }
    }
    // The teacher on manual enrolment: its state as it is is no change, switching it and its role are refused, nothing saved.
    const manual = original.find((m) => m.type === "manual")!;
    assert.equal((await teacher.setEnrolmentMethod(scratch.id, { type: "manual" }, { enabled: manual.enabled })).method.enabled, manual.enabled);
    await assert.rejects(teacher.setEnrolmentMethod(scratch.id, manual.id, { enabled: !manual.enabled }), (e: Error) => e instanceof EnrolmentError && /enrol\/manual:config/.test(e.message));
    await assert.rejects(teacher.setEnrolmentMethod(scratch.id, manual.id, { roleId: TEACHER_ROLE }), (e: Error) => e instanceof EnrolmentError && /roleId/.test(e.message));
    const after = (await admin.enrolmentMethods(scratch.id)).find((m) => m.id === manual.id);
    assert.deepEqual([after?.enabled, after?.roleId], [manual.enabled, manual.roleId]);
  });

  it("unenrolUser: the other student leaves the scratch course", SLOW, async () => {
    assert.ok(otherId, "potentialUsers found the user");
    const teacher = await as("teacher");
    const result = await teacher.unenrolUser(scratch.id, otherId);
    assert.ok(result.removed.length > 0);
    assert.ok(!(await teacher.participants(scratch.id)).some((p) => p.userId === otherId));
    await assert.rejects(teacher.unenrolUser(scratch.id, otherId), EnrolmentError);
  });

  // Notes about the scratch course's student: a course note and a personal note, written, read,
  // edited and deleted by the teacher; the student can't see or write them.
  const noteIds: { course?: number; personal?: number } = {};

  it("addNote: the teacher writes a course note and a personal note about the student", SLOW, async () => {
    const teacher = await as("teacher");
    const course = await teacher.addNote(scratch.id, studentId, { content: `<p>Driver check course note ${stamp}</p>` });
    cleanup(() => quietly(() => teacher.deleteNote(course.noteId)));
    noteIds.course = course.noteId;
    assert.equal(course.note?.context, "course");
    assert.equal(course.note?.userId, studentId);
    assert.equal(course.note?.authorId, teacherId);
    const personal = await teacher.addNote(scratch.id, studentId, { content: `<p>Driver check personal note ${stamp}</p>`, context: "personal" });
    cleanup(() => quietly(() => teacher.deleteNote(personal.noteId)));
    noteIds.personal = personal.noteId;
    assert.equal(personal.note?.context, "personal");
    await assert.rejects((await as("student")).addNote(scratch.id, studentId, { content: "<p>Driver check refused</p>" }), (e: Error) => e instanceof NoteError && /moodle\/notes:manage/.test(e.message));
    await assert.rejects(teacher.addNote(scratch.id, studentId, { content: " " }), (e: Error) => e instanceof MoodleError && e.code === "invalid-input");
  });

  it("notes: the scratch course's notes about the student, as the teacher reads them", SLOW, async () => {
    assert.ok(noteIds.course && noteIds.personal, "addNote wrote the notes");
    const teacher = await as("teacher");
    const all = await teacher.notes(scratch.id);
    const course = all.find((n) => n.id === noteIds.course);
    assert.ok(course, `the course note is listed: ${JSON.stringify(all)}`);
    assert.equal(course.courseId, scratch.id);
    assert.equal(course.userId, studentId);
    assert.ok(course.userName);
    assert.match(course.content, new RegExp(`Driver check course note ${stamp}`));
    assert.equal(course.authorId, teacherId);
    assert.ok(course.authorName);
    assert.ok(course.editable);
    // The dates Moodle shows, read back: written just now.
    assert.ok(course.created && Math.abs(Date.parse(course.created) - Date.now()) < 3_600_000, `created: ${course.created}`);
    assert.ok(course.modified && Date.parse(course.modified) >= Date.parse(course.created));
    assert.equal(all.find((n) => n.id === noteIds.personal)?.context, "personal");
    const about = await teacher.notes(scratch.id, { userId: studentId });
    assert.ok(about.every((n) => n.userId === studentId) && about.length >= 2);
    assert.deepEqual(await teacher.notes(scratch.id, { userId: teacherId }), []);
    const first = await teacher.notes(scratch.id, { limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.more, true);
    await assert.rejects((await as("student")).notes(scratch.id), (e: Error) => e instanceof NoteError && /moodle\/notes:view/.test(e.message));
  });

  it("editNote: the teacher changes the course note's content, and makes the personal note a course note", SLOW, async () => {
    assert.ok(noteIds.course && noteIds.personal, "addNote wrote the notes");
    const teacher = await as("teacher");
    const edited = await teacher.editNote(noteIds.course, { content: `<p>Driver check edited ${stamp}</p>` });
    assert.match(edited.note?.content ?? "", new RegExp(`Driver check edited ${stamp}`));
    assert.equal(edited.note?.context, "course");
    const moved = await teacher.editNote(noteIds.personal, { context: "course" });
    assert.equal(moved.note?.context, "course");
    assert.match(moved.note?.content ?? "", new RegExp(`Driver check personal note ${stamp}`));
    const back = await teacher.editNote(noteIds.personal, { context: "personal" });
    assert.equal(back.note?.context, "personal");
    await assert.rejects((await as("student")).editNote(noteIds.course, { content: "<p>Driver check refused</p>" }), NoteError);
  });

  it("deleteNote: the teacher deletes both notes", SLOW, async () => {
    assert.ok(noteIds.course && noteIds.personal, "addNote wrote the notes");
    const teacher = await as("teacher");
    await assert.rejects((await as("student")).deleteNote(noteIds.course), (e: Error) => e instanceof NoteError && /moodle\/notes:manage/.test(e.message));
    for (const id of [noteIds.course, noteIds.personal]) assert.equal((await teacher.deleteNote(id)).noteId, id);
    const left = await teacher.notes(scratch.id, { userId: studentId });
    assert.ok(!left.some((n) => n.id === noteIds.course || n.id === noteIds.personal));
    await assert.rejects(teacher.deleteNote(noteIds.course), NoteError);
  });
});

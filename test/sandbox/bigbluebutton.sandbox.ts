// BigBlueButton against the sandbox, which has no BigBlueButton server (its URL and secret are empty,
// and Moodle's old test server isn't relied on): a BigBlueButton activity made by the teacher on a
// scratch course, every function refusing it with the missing server's error, and another module
// refused. Moodle 5.2 ships the module disabled: when it is, the admin enables it for the file
// (core_admin_set_plugin_state, as Site administration > Plugins > Activity modules does) and
// disables it again afterwards. What needs a server (the meeting's state, recordings, publishing,
// deleting, the join URL) is skipped with the reason.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { BigBlueButtonError, BigBlueButtonServerError } from "../../src/index.js";
import { callService } from "../../src/internals.js";
import { COURSE, SITE, as, cleanup, scratchCourse, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const NO_SERVER = "the sandbox has no BigBlueButton server";

/** Whether the module is enabled: the activity chooser offers only enabled modules. */
async function moduleEnabled(): Promise<boolean> {
  const admin = await as("admin");
  const items = await callService<{ content_items: { name: string }[] }>(await admin.context(), SITE, "core_course_get_course_content_items", { courseid: COURSE });
  return items.content_items.some((item) => item.name === "bigbluebuttonbn");
}

async function setModuleState(state: 0 | 1): Promise<void> {
  const admin = await as("admin");
  await callService(await admin.context(), SITE, "core_admin_set_plugin_state", { plugin: "mod_bigbluebuttonbn", state });
}

const isServerError = (error: unknown) => error instanceof BigBlueButtonServerError && error.code === "bigbluebutton-server" && /isn't configured/.test(error.message);

describe("bigbluebutton", () => {
  let course: ScratchCourse;
  let activityId: number;

  before(async () => {
    if (!(await moduleEnabled())) {
      await setModuleState(1);
      // Registered before the scratch course, so it runs after the course (and the activity) is deleted.
      cleanup(() => setModuleState(0));
    }
    course = await scratchCourse("bigbluebutton");
    const made = await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "bigbluebuttonbn", name: "Driver check BigBlueButton", visibility: "shown" });
    activityId = made.activityId!;
  }, { timeout: 1_800_000 });

  it("bigBlueButton: without a server, the missing server's error for the teacher and the student, never an empty state", SLOW, async () => {
    await assert.rejects((await as("teacher")).bigBlueButton(activityId), isServerError);
    await assert.rejects((await as("student")).bigBlueButton(activityId), isServerError);
  });

  it("bigBlueButton: another module is refused", SLOW, async () => {
    const structure = await (await as("teacher")).courseStructure(COURSE);
    const other = structure.flatMap((section) => section.activities).find((activity) => activity.type !== "bigbluebuttonbn");
    assert.ok(other, "course 3 has an activity");
    await assert.rejects((await as("teacher")).bigBlueButton(other.id), BigBlueButtonError);
  });

  it("bigBlueButtonJoinUrl: without a server, the missing server's error", SLOW, async () => {
    await assert.rejects((await as("student")).bigBlueButtonJoinUrl(activityId), isServerError);
  });

  it("setRecordingPublished: without a server, the missing server's error", SLOW, async () => {
    await assert.rejects((await as("teacher")).setRecordingPublished(activityId, 1, false), isServerError);
  });

  it("deleteRecording: without a server, the missing server's error", SLOW, async () => {
    await assert.rejects((await as("teacher")).deleteRecording(activityId, 1), isServerError);
  });

  it("bigBlueButton: the meeting's state and its recordings", { skip: NO_SERVER }, () => undefined);
  it("bigBlueButtonJoinUrl: the person's join URL", { skip: NO_SERVER }, () => undefined);
  it("setRecordingPublished: a recording unpublished and published again", { skip: NO_SERVER }, () => undefined);
  it("deleteRecording: a recording deleted", { skip: NO_SERVER }, () => undefined);
});

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Route } from "playwright-core";
import { BigBlueButtonError, BigBlueButtonServerError, MoodleError, bigBlueButton, bigBlueButtonJoinUrl, deleteRecording, setRecordingPublished } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** The activity's page as Moodle 5.2 renders it with a server, reduced: the room (its instance and group) and the recordings table. */
const VIEW = `<div data-activityname="Weekly tutorial"></div><div role="main"><h3>Weekly tutorial</h3>
<div id="bigbluebuttonbn-room-view" class="box py-3 generalbox" data-bbb-id="4" data-group-id="0"><div id="bigbluebuttonbn-room-view-control-panel" data-bbb-id="4"></div></div>
<div id="bigbluebuttonbn-recording-table-1" data-bbbid="4" data-tools="protect,unprotect,publish,unpublish,delete" data-group-id="0"></div></div>`;
/** A recording-only activity: no room, the instance on the recordings table. */
const RECORDINGS_ONLY = `<div data-activityname="Recordings"></div><div role="main"><div id="bigbluebuttonbn-recording-table-2" data-bbbid="9" data-group-id="3"></div></div>`;
/** What Moodle shows without a server's URL and secret: a neutral card, nothing of the room. */
const UNCONFIGURED = `<div data-activityname="Weekly tutorial"></div><div role="main"><div class="container-fluid mt-4"><div class="card"><div class="card-body text-center p-5"><h2 class="card-title">BigBlueButton is not yet configured</h2><p class="card-text">The BigBlueButton server is not yet configured.</p></div></div></div></div>`;

// An action bar tool as recording_row_actionbar renders it; a tool that doesn't apply has its icon marked fa-invisible.
const tool = (action: string, icon: string, hidden: boolean, id: number) =>
  `<div><a href="#" id="recording-${action}-${id}" data-action="${action}" data-require-confirmation="1" class="action-icon${hidden ? " disabled" : ""}"><i class="icon fa fa-${icon} fa-fw iconsmall${hidden ? " fa-invisible" : ""}" title="${action}" role="img"></i></a></div>`;
const actionbar = (id: number, published: boolean, isProtected: boolean) =>
  `<div id="recording-actionbar-${id}" data-recordingid="${id}"><div class="d-flex flex-row">${tool("unprotect", "lock", !isProtected, id)}${tool("protect", "unlock", isProtected, id)}${tool("publish", "eye", published, id)}${tool("unpublish", "eye-slash", !published, id)}${tool("delete", "trash", false, id)}</div></div>`;
const playback = (id: number, published: boolean, imported = false) =>
  `<div id="playbacks-${id}" data-imported="${imported ? "1" : ""}" data-recordingid="${id}" data-additionaloptions="" title="">${
    published
      ? `<span class="p-1"><a href="${SITE}mod/bigbluebuttonbn/bbb_view.php?action=play&amp;bn=4&amp;rid=${id}&amp;rtype=presentation" class="btn btn-sm btn-default" id="recording-play-presentation-${id}" data-action="play" data-target="presentation">Presentation</a></span>`
      : ""
  }</div>`;
const editable = (type: string, id: number, value: string) =>
  `<span class="inplaceeditable inplaceeditable-text" data-inplaceeditable="1" data-component="mod_bigbluebuttonbn" data-itemtype="${type}" data-itemid="${id}" data-value="${value}">${value}<a href="#" class="quickeditlink aalink" data-inplaceeditablelink="1" title="Edit"><span class="quickediticon"><i class="icon fa fa-pen"></i></span></a></span>`;

interface Recording {
  id: number;
  name: string;
  published: boolean;
  protected: boolean;
  date: number;
  minutes: number;
}

/** get_recordings' table for a manager (editable names, the action bar) or a student (published ones, plain names, no action bar). */
function table(recordings: Recording[], manager: boolean) {
  const rows = recordings
    .filter((r) => manager || r.published)
    .map((r) => ({
      playback: playback(r.id, r.published),
      recording: manager ? editable("name", r.id, r.name) : r.name,
      description: manager ? editable("description", r.id, "") : "",
      date: r.date,
      duration: r.minutes,
      ...(manager ? { actionbar: actionbar(r.id, r.published, r.protected) } : {}),
    }));
  return { status: true, tabledata: { activity: "open", ping_interval: 15000, locale: "en", profile_features: ["all"], columns: [], data: JSON.stringify(rows) }, warnings: [] };
}

const MEETING = {
  cmid: 51,
  userlimit: 0,
  bigbluebuttonbnid: "4",
  meetingid: "abc-51-4",
  openingtime: 1_790_000_000,
  closingtime: 1_790_007_200,
  statusrunning: true,
  statusclosed: false,
  statusopen: false,
  startedat: 1_790_000_600,
  moderatorcount: 1,
  participantcount: 3,
  canjoin: true,
  ismoderator: true,
  usermustwaittojoin: false,
  presentations: [],
  joinurl: `${SITE}mod/bigbluebuttonbn/bbb_view.php?action=join&id=51&bn=4`,
  features: [{ name: "showroom", isenabled: true }],
};

async function fake(state: Partial<FakeMoodleState> & { recordings?: Recording[]; manager?: boolean; meeting?: Partial<typeof MEETING> } = {}) {
  const context = await browser!.newContext();
  const recordings = state.recordings ?? [
    { id: 7, name: "Week 1 & intro", published: true, protected: false, date: 1_790_000_600_000, minutes: 52 },
    { id: 8, name: "Week 2", published: false, protected: true, date: 1_790_604_000_000, minutes: 0 },
  ];
  const calls: { methodname: string; args: Record<string, unknown> }[] = [];
  const manager = state.manager ?? true;
  await serveFakeMoodle(context, {
    user: { id: 5, fullName: "Teacher" },
    bodies: { "/mod/bigbluebuttonbn/view.php": VIEW },
    serviceCalls: calls,
    services: {
      mod_bigbluebuttonbn_meeting_info: () => ({ ...MEETING, ...state.meeting }),
      mod_bigbluebuttonbn_get_recordings: () => table(recordings, manager),
      mod_bigbluebuttonbn_update_recording: (args) => {
        if (!manager) throw new ServiceFailure("nopermissions");
        const index = recordings.findIndex((r) => r.id === args.recordingid);
        if (args.action === "delete") recordings.splice(index, 1);
        else recordings[index]!.published = args.action === "publish";
        return [];
      },
      ...state.services,
    },
    ...(state.bodies ? { bodies: state.bodies } : {}),
    ...(state.pagesServed ? { pagesServed: state.pagesServed } : {}),
  });
  return { context, calls, recordings };
}

describe("bigBlueButton", { skip: !browser && "no system browser" }, () => {
  it("reads the meeting from meeting_info and the recordings by structure, for someone who manages them", async () => {
    const { context, calls } = await fake();
    assert.deepEqual(await bigBlueButton(context, SITE, 51), {
      id: 51,
      name: "Weekly tutorial",
      status: "running",
      opensAt: new Date(1_790_000_000_000).toISOString(),
      closesAt: new Date(1_790_007_200_000).toISOString(),
      startedAt: new Date(1_790_000_600_000).toISOString(),
      moderators: 1,
      participants: 3,
      canJoin: true,
      moderator: true,
      waitForModerator: false,
      recordings: [
        {
          id: 7,
          name: "Week 1 & intro",
          date: new Date(1_790_000_600_000).toISOString(),
          minutes: 52,
          published: true,
          protected: false,
          imported: false,
          playbacks: [{ format: "presentation", url: `${SITE}mod/bigbluebuttonbn/bbb_view.php?action=play&bn=4&rid=7&rtype=presentation` }],
        },
        { id: 8, name: "Week 2", date: new Date(1_790_604_000_000).toISOString(), published: false, protected: true, imported: false, playbacks: [] },
      ],
    });
    assert.deepEqual(
      calls.map((c) => [c.methodname, c.args.bigbluebuttonbnid]),
      [
        ["mod_bigbluebuttonbn_meeting_info", 4],
        ["mod_bigbluebuttonbn_get_recordings", 4],
      ],
    );
    await context.close();
  });

  it("gives a student the published recordings, without the protection they can't change, and the schedule's state", async () => {
    const { context } = await fake({ manager: false, meeting: { statusrunning: false, statusopen: false, statusclosed: false, canjoin: false, ismoderator: false, usermustwaittojoin: true, userlimit: 10 } });
    const activity = await bigBlueButton(context, SITE, 51);
    assert.deepEqual([activity.status, activity.canJoin, activity.moderator, activity.waitForModerator, activity.userLimit, activity.startedAt, activity.participants], ["not-open-yet", false, false, true, 10, undefined, undefined]);
    assert.deepEqual(
      activity.recordings.map((r) => [r.id, r.name, r.published, r.protected]),
      [[7, "Week 1 & intro", true, undefined]],
    );
    await context.close();
  });

  it("takes the instance and group from a recording-only activity's table, and lists none for a room-only one", async () => {
    const { context, calls } = await fake({
      bodies: { "/mod/bigbluebuttonbn/view.php": RECORDINGS_ONLY },
      services: { mod_bigbluebuttonbn_get_recordings: () => ({ status: false, warnings: [{ item: 9, warningcode: "instanceprofilewithoutrecordings", message: "No recordings." }] }) },
    });
    assert.deepEqual((await bigBlueButton(context, SITE, 52)).recordings, []);
    assert.deepEqual(calls[0]!.args, { bigbluebuttonbnid: 9, groupid: 3, updatecache: false });
    await context.close();
  });

  it("says when the site's server isn't configured, or doesn't answer, never an empty state", async () => {
    const { context } = await fake({ bodies: { "/mod/bigbluebuttonbn/view.php": UNCONFIGURED } });
    await assert.rejects(bigBlueButton(context, SITE, 51), (error: unknown) => error instanceof BigBlueButtonServerError && error.code === "bigbluebutton-server" && /isn't configured/.test(error.message));
    await context.close();

    const down = await fake({ services: { mod_bigbluebuttonbn_meeting_info: () => { throw new ServiceFailure("general_error_no_answer"); } } });
    await assert.rejects(bigBlueButton(down.context, SITE, 51), (error: unknown) => error instanceof BigBlueButtonServerError && /couldn't reach/.test(error.message));
    // Moodle sends the person back to the course when the server doesn't answer the activity's page.
    // (Served in place: Playwright doesn't route the request after a redirect it fulfilled.)
    await down.context.route(`${SITE}mod/bigbluebuttonbn/view.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 5, bodyId: "page-course-view-topics" }) }));
    await assert.rejects(bigBlueButton(down.context, SITE, 51), BigBlueButtonServerError);
    await down.context.close();
  });

  it("refuses another module, and names the join capability when Moodle won't let the person in", async () => {
    const { context } = await fake();
    await context.route(`${SITE}mod/bigbluebuttonbn/view.php?id=5`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 5, bodyId: "page-site-index" }) }));
    await assert.rejects(bigBlueButton(context, SITE, 5), (error: unknown) => error instanceof BigBlueButtonError && /isn't a BigBlueButton/.test(error.message));
    await context.route(`${SITE}mod/bigbluebuttonbn/view.php?id=6`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 5, bodyId: "page-mod-bigbluebuttonbn-view", body: '<div id="notice" class="box generalbox">You are not allowed to join.</div>' }) }),
    );
    await assert.rejects(bigBlueButtonJoinUrl(context, SITE, 6), (error: unknown) => error instanceof BigBlueButtonError && /mod\/bigbluebuttonbn:join/.test(error.message));
    await context.close();
  });
});

describe("bigBlueButtonJoinUrl", { skip: !browser && "no system browser" }, () => {
  it("gives Moodle's join page, without opening it", async () => {
    const served: string[] = [];
    const { context } = await fake({ pagesServed: served });
    assert.equal(await bigBlueButtonJoinUrl(context, SITE, 51), `${SITE}mod/bigbluebuttonbn/bbb_view.php?action=join&id=51&bn=4`);
    assert.ok(!served.some((path) => path.endsWith("/bbb_view.php")));
    await context.close();
  });

  it("says why the person can't join now", async () => {
    const cases: [Partial<typeof MEETING>, RegExp][] = [
      [{ statusrunning: false, statusopen: false, canjoin: false }, /opens at/],
      [{ statusrunning: false, statusclosed: true, canjoin: false }, /closed at/],
      [{ statusrunning: false, statusopen: true, usermustwaittojoin: true, canjoin: false }, /wait for a moderator/],
      [{ statusrunning: true, userlimit: 4, canjoin: false }, /full/],
      [{ statusrunning: false, statusopen: true, canjoin: false }, /mod\/bigbluebuttonbn:join/],
    ];
    for (const [meeting, why] of cases) {
      const { context } = await fake({ meeting });
      await assert.rejects(bigBlueButtonJoinUrl(context, SITE, 51), (error: unknown) => error instanceof BigBlueButtonError && why.test(error.message));
      await context.close();
    }
  });
});

describe("setRecordingPublished", { skip: !browser && "no system browser" }, () => {
  it("publishes and unpublishes through update_recording, and says when nothing changes", async () => {
    const { context, calls } = await fake();
    const hidden = await setRecordingPublished(context, SITE, 51, 7, false);
    assert.match(hidden.changed, /Unpublished recording 7/);
    assert.deepEqual([hidden.recording.id, hidden.recording.published, hidden.recording.playbacks], [7, false, []]);
    const update = calls.find((c) => c.methodname === "mod_bigbluebuttonbn_update_recording");
    assert.deepEqual(update?.args, { bigbluebuttonbnid: 4, recordingid: 7, action: "unpublish", additionaloptions: "{}" });
    const again = await setRecordingPublished(context, SITE, 51, 7, false);
    assert.match(again.changed, /already unpublished/);
    assert.equal((await setRecordingPublished(context, SITE, 51, 7, true)).recording.published, true);
    assert.equal(calls.filter((c) => c.methodname === "mod_bigbluebuttonbn_update_recording").length, 2);
    await context.close();
  });

  it("names the capabilities when the person can't manage recordings, and refuses a recording it doesn't list", async () => {
    const { context } = await fake({ manager: false });
    await assert.rejects(setRecordingPublished(context, SITE, 51, 7, false), (error: unknown) => error instanceof BigBlueButtonError && /mod\/bigbluebuttonbn:managerecordings/.test(error.message) && /unpublishrecordings/.test(error.message));
    await assert.rejects(setRecordingPublished(context, SITE, 51, 8, true), (error: unknown) => error instanceof MoodleError && error.code === "not-found");
    await context.close();
  });
});

describe("deleteRecording", { skip: !browser && "no system browser" }, () => {
  it("deletes a recording and checks it's gone", async () => {
    const { context, recordings } = await fake();
    assert.deepEqual(await deleteRecording(context, SITE, 51, 8), { changed: "Deleted recording 8 of BigBlueButton 51.", recordingId: 8 });
    assert.deepEqual(
      recordings.map((r) => r.id),
      [7],
    );
    await assert.rejects(deleteRecording(context, SITE, 51, 8), (error: unknown) => error instanceof MoodleError && error.code === "not-found");
    await context.close();
  });
});

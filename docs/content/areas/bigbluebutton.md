# BigBlueButton

BigBlueButton activities (module `bigbluebuttonbn`): the meeting's state and schedule, whether the person can join now, and its recordings; for those who manage recordings, a recording published, unpublished or deleted; and the person's join URL, for the person to open. The driver never joins a meeting. Creating one is `createActivity` with `type: "bigbluebuttonbn"` (see [Activities and sections](activities.md)).

**Terms:** [BigBlueButton](../reference/glossary.md#bigbluebutton) and [instance id](../reference/glossary.md#instance-id).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Every function opens the activity's page first (Moodle logs a view), for the instance id Moodle's AJAX services take (`mod_bigbluebuttonbn_meeting_info`, `mod_bigbluebuttonbn_get_recordings`, `mod_bigbluebuttonbn_update_recording`); the recordings' cells come as HTML and are read by their structure (data attributes, icon classes), so it works in any interface language. They all need the site's BigBlueButton server: Moodle asks it for the meeting and the recordings. They throw `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## A site without a server {#a-site-without-a-server}

A site whose BigBlueButton server isn't configured (no server URL or shared secret in Site administration > Plugins > Activity modules > BigBlueButton) shows a neutral page instead of the meeting, and one whose server doesn't answer sends the person back to the course. Every function then throws `BigBlueButtonServerError` (code `bigbluebutton-server`), never an empty state: there is no meeting state or recording to read without a server. Moodle ships the module disabled: an administrator enables it in Site administration > Plugins > Activity modules > Manage activities before anyone can create one. On Moodle 4.x the activity's form itself checks the server before it opens, so without a server it can reach no BigBlueButton can be created: `createActivity` throws `FormError` with Moodle's own message ("Unable to connect to the BigBlueButton server…").

## bigBlueButton

A BigBlueButton activity as the person sees it.

```ts
function bigBlueButton(context: BrowserContext, siteUrl: string, activityId: number): Promise<BigBlueButtonActivity>;

interface BigBlueButtonActivity {
  id: number;
  name: string;
  status: "not-open-yet" | "open" | "running" | "closed";
  opensAt?: string;
  closesAt?: string;
  startedAt?: string;
  moderators?: number;
  participants?: number;
  canJoin: boolean;
  moderator: boolean;
  waitForModerator: boolean;
  userLimit?: number;
  recordings: BigBlueButtonRecording[];
}

interface BigBlueButtonRecording {
  id: number;
  name: string;
  description?: string;
  date?: string;
  minutes?: number;
  published: boolean;
  protected?: boolean;
  imported: boolean;
  playbacks: { format: string; url: string }[];
}
```

- `status`: `not-open-yet` before its opening time, `open` while it can be joined, `running` while someone is in it (then `startedAt`, `moderators` and `participants`), `closed` after its closing time. `opensAt` and `closesAt`: its schedule, when it has one.
- `canJoin`: whether the person can join now: it's open, there's room (`userLimit`), a moderator is there when viewers must wait for one (`waitForModerator`), and the person has `mod/bigbluebuttonbn:join`. `moderator`: whether they join as one.
- `recordings`: all of them for someone with `mod/bigbluebuttonbn:managerecordings`, the published ones for the rest; none for an activity of the "room only" type. `date`: when the recorded meeting started; `minutes`: its length, as the server reports it; `playbacks`: Moodle's URLs that play it, in each `format` ("presentation", "video"…), only while it's published. `protected` (playback only through Moodle) is there where the server supports it and the person may change it.

Throws `BigBlueButtonError` when the id isn't a BigBlueButton the person can open, and `BigBlueButtonServerError` (see [A site without a server](#a-site-without-a-server)).

## bigBlueButtonJoinUrl

The person's URL to join the meeting: Moodle's join page (`mod/bigbluebuttonbn/bbb_view.php?action=join…`), which creates the meeting when it isn't running and sends the person into it. It's for the person to open in their browser; the driver doesn't open it.

```ts
function bigBlueButtonJoinUrl(context: BrowserContext, siteUrl: string, activityId: number): Promise<string>;
```

Throws `BigBlueButtonError` saying why when the person can't join now: not open yet or closed (with the time), viewers waiting for a moderator, the meeting full, or a role without `mod/bigbluebuttonbn:join`.

## setRecordingPublished

Publishes or unpublishes a recording. This is how a recording is hidden: an unpublished recording is listed only to those who manage recordings, and its playbacks are off for everyone. Moodle's "protect" is something else (the playback only through Moodle, not by the server's own link), which the driver reads as `protected` but doesn't change.

```ts
function setRecordingPublished(context: BrowserContext, siteUrl: string, activityId: number, recordingId: number, published: boolean): Promise<{ changed: string; recording: BigBlueButtonRecording }>;
```

- `recordingId`: one of `bigBlueButton`'s `recordings`; `recording`: it afterwards. Nothing changes when it's already so (`changed` says it).
- Takes `mod/bigbluebuttonbn:managerecordings` and `mod/bigbluebuttonbn:publishrecordings` or `mod/bigbluebuttonbn:unpublishrecordings` (editing teachers have them): without them, `BigBlueButtonError` naming them. A recording the activity doesn't list: a `MoodleError` (`not-found`).

## deleteRecording

Deletes a recording: on the BigBlueButton server too, unless it was imported from another activity (then only its link here goes).

```ts
function deleteRecording(context: BrowserContext, siteUrl: string, activityId: number, recordingId: number): Promise<{ changed: string; recordingId: number }>;
```

Takes `mod/bigbluebuttonbn:managerecordings` and `mod/bigbluebuttonbn:deleterecordings`; the errors are `setRecordingPublished`'s.

## Example

```ts
import { BigBlueButtonError, BigBlueButtonServerError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const meeting = await moodle.bigBlueButton(51);
  console.log(`${meeting.name}: ${meeting.status}${meeting.opensAt ? `, opens ${meeting.opensAt}` : ""}`);
  if (meeting.canJoin) console.log(`Join at ${await moodle.bigBlueButtonJoinUrl(51)}`);

  // Hide last week's recording from students.
  for (const recording of meeting.recordings) {
    console.log(`  ${recording.id} ${recording.name} (${recording.minutes ?? "?"} min) ${recording.published ? "published" : "hidden"}`);
  }
  const last = meeting.recordings[0];
  if (last?.published) console.log((await moodle.setRecordingPublished(51, last.id, false)).changed);
} catch (error) {
  if (error instanceof BigBlueButtonServerError) console.error(`No server: ${error.message}`);
  else if (error instanceof BigBlueButtonError) console.error(error.message);
  else throw error;
}
```

## Data categories

- `bigBlueButton`: `course-content` and `others-personal` (the meeting and its recordings, which show the people in them).
- `bigBlueButtonJoinUrl`: `own` (the person's way in).
- `setRecordingPublished`, `deleteRecording`: `course-content`.

See [Data categories](../concepts/data-categories.md).

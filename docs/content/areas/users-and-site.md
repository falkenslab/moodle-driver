# Users and the site

Who the logged-in person is, other users by id, a user's roles and the person's abilities in a course, and what the site tells about itself, before and after logging in. Anyone logged in can use them; what Moodle shows of another user depends on the person's rights. Three functions need no browser or session at all (`parseSiteUrl`, `findMoodleSite`, `publicSiteInfo`): a program can use them to check the site the person gives before [logging in](../getting-started/logging-in.md).

**Terms:** [site](../reference/glossary.md#site), [session](../reference/glossary.md#session), [role](../reference/glossary.md#role).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## whoAmI

Who the logged-in person is; with a course, also their roles and abilities there.

```ts
function whoAmI(context: BrowserContext, siteUrl: string, courseId?: number): Promise<Me>;

interface Me {
  userId: number;
  username?: string;
  fullName: string;
  email?: string;
  language: string;
  timeZone: string;
  firstAccess?: string;
  lastAccess?: string;
  site: { name?: string; url: string };
  course?: { id: number; roles: { id: number; name: string }[]; canEdit: boolean; canGrade: boolean };
}
```

- `userId`, `language` and `timeZone` come from the page's `M.cfg` (`language` is the interface language in use, `timeZone` the person's time zone in Moodle, such as `"Europe/Madrid"`).
- `username`, `fullName`, `email`, `firstAccess` and `lastAccess` (ISO 8601) come from `userById` for the person.
- `site.name` is `siteName`'s answer, `site.url` the URL given.
- `course`, only with `courseId`: `roles` as `courseRoles` reads them, and `canEdit` and `canGrade` as `courseAbilities` tells.

It throws `NotLoggedInError` without a session, and `MoodleServiceError` for a course the person can't see (the course's state is read first, which checks it).

## userById

A user by id, through `core_user_get_users_by_field`, or `undefined` when Moodle gives nobody.

```ts
function userById(context: BrowserContext, siteUrl: string, userId: number): Promise<User | undefined>;

interface User {
  id: number;
  username?: string;
  fullName: string;
  email?: string;
  firstAccess?: string;
  lastAccess?: string;
}
```

`firstAccess` and `lastAccess` are ISO 8601 dates, left out when the user never came. Moodle decides what it returns: the optional fields come only when the person may see them (a student usually doesn't get other users' usernames or emails), and a user the person isn't allowed to see may come back as `undefined`.

## courseRoles

A user's roles in a course, read from their course profile (`user/view.php?id=<user>&course=<course>`).

```ts
function courseRoles(context: BrowserContext, siteUrl: string, userId: number, courseId: number): Promise<{ id: number; name: string }[]>;
```

Each role's `id` comes from the role links' `roleid`, so it's reliable in any language; `name` is the role's name as the page shows it (`"Non-editing teacher"`). A user with no role in the course gives an empty list. It throws `NotLoggedInError` without a session.

## courseAbilities

What the person can do in a course, asked of read-only services that need the capability; nothing is changed.

```ts
function courseAbilities(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number): Promise<{ canEdit: boolean; canGrade: boolean }>;
```

- `canEdit`: the activity chooser offers the person some type to add to the section (`core_courseformat_get_section_content_items`), which needs `moodle/course:manageactivities`.
- `canGrade`: the grader report's users can be read (`gradereport_grader_get_users_in_report`); a `nopermissions` answer means `false`.

`sectionId` is any section of the course (its id, from the [course structure](courses.md)); `whoAmI` uses the first one. Errors other than `nopermissions` pass as `MoodleServiceError`.

## siteName

The site's name, from its public settings (`tool_mobile_get_public_config`) with the person's session.

```ts
function siteName(context: BrowserContext, siteUrl: string): Promise<string | undefined>;
```

It returns `undefined` when the call fails for any reason, such as a site with the mobile app's support turned off. It never throws, not even without a session.

## publicSiteInfo

What the site tells anyone about itself, through Moodle's entry point for services that need no login (`lib/ajax/service-nologin.php`): no browser, no session.

```ts
function publicSiteInfo(
  siteUrl: string,
  fetchImpl?: typeof fetch,
): Promise<{
  name: string;
  url: string;
  language?: string;
  languages?: string[];
  login: { appLogin?: "app" | "browser" | "embedded"; guestAccess: boolean; identityProviders: string[] };
  maintenance?: string;
  supportPage?: string;
}>;
```

- `name`: the site's name, entities decoded; `url`: its `wwwroot`.
- `language`: the default language; `languages`: the codes the language menu offers, absent when the site doesn't restrict them (every installed language).
- `login.appLogin`: how the site tells Moodle's mobile app to log in, which hints whether it uses its own form (`"app"`) or a browser (`"browser"`, `"embedded"`, as single sign-on sites do); `guestAccess`: guests can log in; `identityProviders`: the names of the login page's identity providers (`"Google"`, `"CAS"`).
- `maintenance`: the maintenance message, only when the site is in maintenance mode.
- `supportPage`: the site's support page, when it has one.

Moodle shows its version only to administrators, so it isn't here. `fetchImpl` defaults to the global `fetch` (a program or a test may pass its own); the request times out after 60 seconds. A failing service comes back as `MoodleServiceError` (a site with the mobile app's services off answers one), and a site that can't be reached as the `fetch` error.

## findMoodleSite and parseSiteUrl

```ts
function parseSiteUrl(value: string): string;
function findMoodleSite(url: string, fetchImpl?: typeof fetch): Promise<string>;
```

`parseSiteUrl` normalizes a site's base URL without fetching anything: http or https, no query or fragment, and a trailing slash (`"https://campus.example.org/moodle"` becomes `"https://campus.example.org/moodle/"`). It throws `MoodleUrlError` for something that isn't a URL or isn't http(s). Every function takes the site URL in this form.

`findMoodleSite` finds the site's base URL from any URL of it (the home page, a course, the login page, a URL the person copied from the address bar): it fetches the page, following redirects, and reads the `M.cfg.wwwroot` Moodle puts in every page, then normalizes it with `parseSiteUrl`. No browser or session is used, and it waits up to 60 seconds, since a site that just started can take long to answer. It throws `MoodleUrlError` when the URL is malformed, the site can't be reached, or the page isn't Moodle's.

## Example

```ts
import { MoodleUrlError, createMoodle, findMoodleSite, publicSiteInfo } from "@falkenslab/moodle-driver";

// Before logging in: from what the person pasted to the site's base URL.
let site: string;
try {
  site = await findMoodleSite("https://campus.example.org/course/view.php?id=3");
} catch (error) {
  if (error instanceof MoodleUrlError) throw new Error(`That isn't a Moodle site: ${error.message}`);
  throw error;
}
const info = await publicSiteInfo(site);
if (info.maintenance) console.log(`${info.name} is in maintenance: ${info.maintenance}`);

// Then the site goes into the object every call uses; after logging in:
const moodle = createMoodle({ site, profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn({ timeoutMs: 5 * 60_000 });
const me = await moodle.whoAmI(3);
console.log(`${me.fullName} (${me.userId}), ${me.timeZone}`);
console.log(me.course?.roles.map((r) => r.name), me.course?.canEdit ? "can edit" : "can't edit");
```

## Data categories

`whoAmI` and `courseAbilities` are `own`. `userById` and `courseRoles` are `others-personal` (they read anyone's data, the person's included). `siteName`, `publicSiteInfo`, `findMoodleSite`, `parseSiteUrl` and the lower-level `readWwwroot` are `none`; the lower-level `readPageConfig` and `readOwnProfile` are `own`. See [data categories](../concepts/data-categories.md).

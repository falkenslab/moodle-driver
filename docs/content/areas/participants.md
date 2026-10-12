# Participants

This area lists who is in a course: its participants with their roles and groups (`participants`), its groups with their members (`groups`), and the roles and groups the participants page filters by (`participantFilters`). A teacher also changes who is in it: enrolling users (`potentialUsers`, `enrolUsers`), unenrolling them (`unenrolUser`), giving or taking roles (`setUserRoles`), making groups and groupings and choosing their members (`createGroup`, `setGroupMembers`, `groupings`, `createGrouping`…), and setting how people get in: the course's enrolment methods (`enrolmentMethods`, `setEnrolmentMethod`). Reading is mostly for teachers, but it works for anyone who can open the course's participants page: a student sees what Moodle shows them there (in a course with separate groups, only their own group).

**Terms:** [participant](../reference/glossary.md#participant), [role](../reference/glossary.md#role), [group](../reference/glossary.md#group).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

People come as a user id and a full name, with their roles and groups by id. Emails (except for `potentialUsers`), phone numbers, profile fields, pictures and last access dates are deliberately left out: telling participants apart, filtering them and acting on them (grading, overriding, messaging) needs nothing else. A single user is read by id with `userById` (see [Users and site](users-and-site.md)).

## How it reads Moodle

The participants come from the participants page's own table service (`core_table_get_dynamic_table_content`), the one the page calls when its filters change, 100 people per request, sorted by last name. The roles and groups are read from the page's filter menus (`user/index.php`) by their option values, so the ids are the same whatever the site's language. Each role and each group is one filter of its own: a course with many roles or groups takes one request per role and per group (and more for large courses).

## participants

A course's participants with their roles and groups, optionally only those with a role, in a group, or inactive since a date.

```ts
function participants(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { role?: number; group?: number; inactiveSince?: Date; limit?: number; offset?: number },
): Promise<Participant[]>; // ListPage<Participant> with limit

interface Participant {
  userId: number;
  fullName: string;
  roles: { id: number; name: string }[];
  groups: { id: number; name: string }[];
}
```

Options (all optional, combined when several are given):

- `role`: a role id from `participantFilters` (5 is Student on a default site, but read it rather than assume it).
- `group`: a group id from `participantFilters` or `groups`.
- `inactiveSince`: only those who haven't accessed the course since that date, as the page's "Inactive for more than" filter does.
- `limit`, `offset`: a page of them, by last name as the page lists them (see [Long lists](../concepts/calling-functions.md#long-lists)): the one page of the table's own paging that holds it. Each role's and group's members are still read whole, to tell the page's participants' roles and groups.

Each participant comes with every role and group they have in the course (`roles` and `groups` may be empty: someone without a role, or in no group). It throws `NoParticipantsError` when the person can't see the course's participants, or the course doesn't exist.

## groups

The course's groups the person can see, each with its members' user ids.

```ts
function groups(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseGroup[]>;

interface CourseGroup {
  id: number;
  name: string;
  members: number[];
}
```

The groups are those the participants page offers to the person: every group for a teacher, only their own in a course with separate groups. It throws `NoParticipantsError` like `participants`.

## participantFilters

The roles and groups the participants page filters by in a course, as the person may use them.

```ts
function participantFilters(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ roles: { id: number; name: string }[]; groups: { id: number; name: string }[] }>;
```

Names are in the site's language ("Student", "Estudiante"); ids are what `participants` and `graderReport` take. The page's "No roles" and "No group" options are left out. It throws `NoParticipantsError` when the person can't open the page.

## potentialUsers

Users the person may enrol in a course by manual enrolment, as the participants page's "Enrol users" dialog finds them.

```ts
function potentialUsers(context: BrowserContext, siteUrl: string, courseId: number, search?: string): Promise<PotentialUser[]>;

interface PotentialUser {
  userId: number;
  fullName: string;
  email?: string;
}
```

`search` matches anywhere in the name or the identity fields the site shows to the person (empty: anyone, up to 100). Users already enrolled are left out. `email` comes only when the site shows it to the person; it's the one place this area returns one, since telling apart people who aren't participants yet may need it. It comes from `core_enrol_get_potential_users`, the dialog's own service. It throws `EnrolmentError` when the course has no manual enrolment the person can use (not among its enrolment methods, disabled, or no permission to enrol), `NoParticipantsError` when the person can't open the participants page.

## enrolUsers

Enrols users by the course's manual enrolment, as the "Enrol users" dialog does.

```ts
function enrolUsers(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  userIds: number[],
  options?: { roleId?: number; start?: Date; end?: Date },
): Promise<{ changed: string; count: number; roleId?: number }>;
```

- `roleId`: the role to give; the manual enrolment's default role (usually Student) when left out. The roles the person may give are those of `setUserRoles`.
- `start`: when the enrolment starts; the dialog's default ("Now", or what the site sets) when left out.
- `end`: when it ends; the enrolment's default duration (unlimited unless the method sets one) when left out.

Dates are sent in the person's time zone in Moodle, as the dialog's date selectors are. The driver reads the dialog's form (`core_get_fragment`) for its defaults and submits it where the dialog does (`enrol/manual/ajax.php`); `count` is the number Moodle reports enrolled. A user already enrolled by that method keeps the enrolment, with the new role added and the new dates. Moodle's refusals throw `EnrolmentError` with its reason: a role the person can't assign ("Invalid role"), no manual enrolment.

## unenrolUser

Removes a user from a course, as the unenrol icon in the participants page's status column does, once for each enrolment the user has there.

```ts
function unenrolUser(context: BrowserContext, siteUrl: string, courseId: number, userId: number): Promise<{ changed: string; removed: string[]; kept: string[] }>;
```

Every enrolment of the user's that the person may remove goes (`core_enrol_unenrol_user_enrolment`), and with it Moodle takes their roles and group memberships in the course; `removed` names them by enrolment method ("Manual enrolments"), `kept` names those the person can't remove (a cohort sync, a method without the permission), which keep the user in the course. It throws `EnrolmentError` when the user isn't enrolled, or when none of their enrolments can be removed.

## setUserRoles

Sets a user's roles in a course, as the participants page's roles column does.

```ts
function setUserRoles(context: BrowserContext, siteUrl: string, courseId: number, userId: number, roleIds: number[]): Promise<{ changed: string; roleIds: number[] }>;
```

The roles in `roleIds` are given and the other roles the person may assign are taken away; roles the person can't assign, and those from elsewhere (a category, an enrolment method that protects its roles), stay. The result is the user's roles afterwards as the column shows them. It goes through the column's own service (`core_update_inplace_editable`). An editing teacher may usually assign Non-editing teacher and Student, not Teacher: a role outside those is refused with `EnrolmentError` and Moodle's reason ("Role cannot be assigned in this course"), as is a user who isn't enrolled ("User does not belong to the course").

## Groups and groupings

A teacher makes, changes and deletes a course's groups and groupings, and chooses their members, on Moodle's group pages: no group service that writes is open to AJAX. Each write returns `changed`, and those that create something the new id.

```ts
function createGroup(context: BrowserContext, siteUrl: string, courseId: number, settings: GroupSettings & { name: string }): Promise<{ changed: string; groupId: number }>;
function updateGroup(context: BrowserContext, siteUrl: string, groupId: number, settings: GroupSettings): Promise<{ changed: string }>;
function deleteGroup(context: BrowserContext, siteUrl: string, groupId: number): Promise<{ changed: string }>;
function setGroupMembers(context: BrowserContext, siteUrl: string, groupId: number, change: { add?: number[]; remove?: number[] }): Promise<{ changed: string; members: number[] }>;

function groupings(context: BrowserContext, siteUrl: string, courseId: number): Promise<Grouping[]>;
function createGrouping(context: BrowserContext, siteUrl: string, courseId: number, settings: GroupingSettings & { name: string }): Promise<{ changed: string; groupingId: number }>;
function deleteGrouping(context: BrowserContext, siteUrl: string, groupingId: number): Promise<{ changed: string }>;
function setGroupingGroups(context: BrowserContext, siteUrl: string, groupingId: number, groupIds: number[]): Promise<{ changed: string; groupIds: number[] }>;

interface GroupSettings {
  name?: string;
  description?: string; // HTML
  idNumber?: string;
  enrolmentKey?: string; // puts a student who self-enrols with it in this group
}

interface GroupingSettings {
  name?: string;
  description?: string;
  idNumber?: string;
}

interface Grouping {
  id: number;
  name: string;
  groupIds: number[];
}
```

- `createGroup`, `updateGroup`, `createGrouping` fill the group's or grouping's form (`group/group.php`, `group/grouping.php`); what isn't given stays as it was. Moodle's refusals come as `FormError` with its reason by field: a group name already used in the course, an enrolment key another group has.
- `setGroupMembers` adds and removes user ids on the group's members page (`group/members.php`), as its Add and Remove buttons do, and returns the members afterwards. Only participants of the course can be added: ids the page doesn't offer are left as they were and named in `changed`.
- `groupings` reads the course's groupings page and each grouping's groups page (a person without `moodle/course:managegroups`, a student, gets a `MoodleError` with Moodle's refusal); `setGroupingGroups` makes a grouping's groups exactly those given on that page (`group/assign.php`), leaving out ids that aren't groups of the course.
- `deleteGroup` and `deleteGrouping` do what their confirmation does; the group's members stay in the course, a grouping's groups stay as groups.

A group or grouping that doesn't exist, or that the person can't manage, throws a `MoodleError` (code `not-found`) with Moodle's message. `groups` reads groups with their members.

## Enrolment methods

How people get into a course: manual enrolment, self enrolment (with or without a key), guest access… read and set on the course's "Enrolment methods" page (`enrol/instances.php`) and each method's form (`enrol/editinstance.php`); no service for them is open to AJAX.

```ts
function enrolmentMethods(context: BrowserContext, siteUrl: string, courseId: number): Promise<EnrolmentMethod[]>;
function setEnrolmentMethod(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  method: number | { type: string },
  settings: EnrolmentMethodSettings,
): Promise<{ changed: string; method: EnrolmentMethod }>;

interface EnrolmentMethod {
  id: number;
  type: string; // "manual", "self", "guest", "cohort"…
  name: string; // as the page names it, in the site's language
  enabled: boolean;
  users: number;
  roleId?: number;
  hasKey?: boolean; // self enrolment and guest access; the key itself is never returned
  start?: string; // self enrolment: ISO dates
  end?: string;
  maxUsers?: number; // self enrolment
}

interface EnrolmentMethodSettings {
  enabled?: boolean;
  key?: string; // "" removes it
  start?: Date | null; // null removes the date
  end?: Date | null;
  roleId?: number;
  maxUsers?: number; // 0: no limit
  welcome?: string | false; // manual and self enrolment's welcome message; false sends none
}
```

`enrolmentMethods` lists the methods in the order Moodle tries them, and opens each method's form for its role, key, dates and limit. What a form shows depends on the person's permissions: an editing teacher usually configures self enrolment and guest access but not manual enrolment, whose role then isn't returned.

`setEnrolmentMethod` takes a method by id, or by type (`{ type: "self" }`: the course's first one of that type, added when the course has none and the page's "Add method" menu offers it). Only the settings given change; dates are in the person's time zone in Moodle. A welcome message turns sending on (from the course contact, unless another sender was chosen). `enabled` switches an existing method with the enable and disable icons of its row on the methods page, as a person would; the other settings go through its form (a new method takes its state from the form too). It returns the method afterwards.

What Moodle lets the person change depends on the method and their permissions: an editing teacher switches and configures self enrolment and guest access, but not manual enrolment (it takes `enrol/manual:config`, which by default only managers and admins have): Moodle offers them neither its icons nor its status and role, only its welcome message. Asking for a state the method already has is no change, so `{ enabled: true }` on an enabled manual method succeeds for them too. Disabling the method the person is enrolled through asks for a confirmation in Moodle that the driver doesn't give.

It throws `EnrolmentError` for a method the course doesn't have and can't add, when the person can't manage the course's methods, and for a setting Moodle doesn't let them change (naming it, before anything is saved); `FormError` with Moodle's reason when it refuses the form.

A student enrols with the key in Moodle itself (the course's "Enrol me"); the driver only sets the method up.

## Messaging participants

`messageParticipants` (in [Messages](messages.md)) writes one message to several participants at once, chosen as `participants` chooses them: by role, group or inactivity.

## Pseudonymizing

The driver returns real names: it's a library for any program, and what a program does with names is its own choice. A program that hands participants' data to someone else (an AI model, say) pseudonymizes it itself; moodle-mcp, one consumer, does it with `@falkenslab/pseudonym`. User ids are stable within a site, so a program can keep a table from id to pseudonym and translate back before acting.

## Example

Find the students in group "Group A" who haven't opened course 3 in two weeks.

```ts
import { NoParticipantsError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const { roles, groups } = await moodle.participantFilters(3);
  const student = roles.find((r) => r.name === "Student");
  const groupA = groups.find((g) => g.name === "Group A");
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const inactive = await moodle.participants(3, { role: student?.id, group: groupA?.id, inactiveSince: twoWeeksAgo });
  for (const person of inactive) console.log(person.userId, person.fullName);
} catch (error) {
  if (error instanceof NoParticipantsError) console.log(error.message);
  else throw error;
}
```

Matching roles by name works on an English site only; a program for any site matches by id, or lets the person choose from `roles`.

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `participants`, `groups`: `others-personal`.
- `participantFilters`: `course-content` (the course's roles and groups, nobody's data).
- `potentialUsers`: `others-personal`.
- `createGroup`, `updateGroup`, `deleteGroup`, `groupings`, `createGrouping`, `deleteGrouping`, `setGroupingGroups`: `course-content`.
- `setGroupMembers`: `others-personal` and `others-write`.
- `enrolmentMethods`, `setEnrolmentMethod`: `course-content`.
- `enrolUsers`, `unenrolUser`, `setUserRoles`: `others-personal` and `others-write` (deciding who is in the course and with which role).

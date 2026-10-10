# Participants

This area lists who is in a course: its participants with their roles and groups (`participants`), its groups with their members (`groups`), and the roles and groups the participants page filters by (`participantFilters`). It's mostly for teachers, but it works for anyone who can open the course's participants page: a student sees what Moodle shows them there (in a course with separate groups, only their own group).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

People come as a user id and a full name, with their roles and groups by id. Emails, phone numbers, profile fields, pictures and last access dates are deliberately left out: telling participants apart, filtering them and acting on them (grading, overriding, messaging) needs nothing else. A single user is read by id with `userById` (see [Users and site](users-and-site.md)).

## How it reads Moodle

The participants come from the participants page's own table service (`core_table_get_dynamic_table_content`), the one the page calls when its filters change, 100 people per request, sorted by last name. The roles and groups are read from the page's filter menus (`user/index.php`) by their option values, so the ids are the same whatever the site's language. Each role and each group is one filter of its own: a course with many roles or groups takes one request per role and per group (and more for large courses).

## participants

A course's participants with their roles and groups, optionally only those with a role, in a group, or inactive since a date.

```ts
function participants(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { role?: number; group?: number; inactiveSince?: Date },
): Promise<Participant[]>;

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

# Badges

This area works a course's badges: reading them (`courseBadges`), creating one (`createBadge`), setting what earns it (`setBadgeCriteria`), enabling or disabling it (`setBadgeEnabled`) and awarding it by hand (`awardBadge`). Anyone in the course can read its enabled badges; creating them, setting their criteria and awarding them takes Moodle's badge capabilities in the course, which editing teachers have by default. Site badges aren't covered: only course badges.

**Terms:** [badge](../reference/glossary.md#badge).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## How a badge works in Moodle

A badge starts disabled ("Not available to users") and without criteria. Its criteria say what earns it: completing activities, completing the course, being awarded it by hand by someone with a given role, and other kinds the driver doesn't set (other badges, competencies, profile fields). With more than one criterion, the badge says whether all must be met or any one. Once enabled, Moodle awards it at once to whoever already meets its criteria, and later to whoever meets them. While a badge is enabled its criteria can't change; once someone has it, Moodle locks it, and its criteria never change again (a teacher copies it instead).

Moodle reads none of this through a service open to AJAX: the driver reads the course's badges page (`badges/index.php`), each badge's overview, its criteria page and criterion forms, and its award page, as a teacher would. Enabling and disabling go through the services the badges page's own buttons call (`core_badges_enable_badges`, `core_badges_disable_badges`).

## CourseBadge

The badges `courseBadges` lists and the writes return:

```ts
interface CourseBadge {
  id: number;
  courseId: number;
  name: string;
  description: string;
  imageUrl: string;
  enabled: boolean;
  criteria: string;
  recipients?: number;
  awarded: boolean;
}
```

- `id`: the badge's id, what the other functions take.
- `description`: plain text (Moodle strips tags from it).
- `imageUrl`: the large version of its image, as Moodle serves it; `downloadFile` saves it with the session.
- `enabled`: whether it's available to users. Only an enabled badge is awarded.
- `criteria`: what earns it, as the badges page sums it up, in the site's language (`""` without criteria). It's for showing to a person; `setBadgeCriteria` returns the criteria as data.
- `recipients`: how many people have it, for whom may see who has it (a teacher); absent for a student.
- `awarded`: whether the person has it.

## courseBadges

A course's badges, as its badges page lists them, with each one's description and image from its overview.

```ts
function courseBadges(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseBadge[]>;
```

A student sees only enabled badges, without `recipients`; a teacher sees disabled ones too. The badges page shows a page of its table; the rest, on a course with more badges than that, comes from the table's own service (`core_table_get_dynamic_table_content`), as its paging does.

It throws `BadgesDisabledError` on a site with badges, or course badges, turned off; `BadgeError` when the person can't see the course's badges (Moodle sends them to the front page).

## createBadge

Creates a course badge through Moodle's new badge form, disabled and without criteria, and returns it.

```ts
function createBadge(context: BrowserContext, siteUrl: string, courseId: number, badge: NewBadge): Promise<{ changed: string; badge: CourseBadge }>;

interface NewBadge {
  name: string;
  description: string;
  image: string;
  imageCaption?: string;
}
```

- `name`, `description`: required by Moodle; the description is plain text.
- `image`: a local image file, as an absolute path: PNG, JPEG or GIF, at most 256 KB. It's uploaded as the form's file picker does; Moodle resizes it.
- `imageCaption`: the image's caption, its alternative text.

The issuer (name and contact) is the site's default, as the form fills it. It throws `BadgeError` when the person can't create badges in the course (it takes `moodle/badges:createbadge`), `BadgesDisabledError` on a site with badges off, a `MoodleError` with code `not-found` for an image that isn't there, and `FormError` with Moodle's reason when it refuses the form.

## setBadgeCriteria

Sets what earns a badge, through its criteria page and each criterion's form, and returns the criteria afterwards.

```ts
function setBadgeCriteria(context: BrowserContext, siteUrl: string, badgeId: number, changes: BadgeCriteriaChanges): Promise<{ changed: string; criteria: BadgeCriteria }>;

interface BadgeCriteriaChanges {
  activities?: { activityIds: number[]; all?: boolean } | null;
  courseCompletion?: { minGrade?: number; by?: Date } | null;
  manual?: { roleIds: number[]; all?: boolean } | null;
  all?: boolean;
}

interface BadgeCriteria {
  activities?: { activityIds: number[]; all: boolean };
  courseCompletion?: { minGrade?: number; by?: string };
  manual?: { roleIds: number[]; all: boolean };
  all?: boolean;
}
```

- `activities`: completing these activities, by course module id. Moodle offers only the course's activities with completion tracking. `all` (default `true`) requires every one; `false`, any one. Moodle's form starts at "any": the driver's default is what a list of activities usually means.
- `courseCompletion`: completing the course, which must track completion. `minGrade` adds a minimum course grade; `by`, a date to complete it by (the day counts, in the person's time zone).
- `manual`: awarded by hand by people with these roles, by role id (3 is the editing teacher on a standard site; `courseRoles` gives a person's roles in a course). Moodle offers only roles that may award badges. `all` (default `false`) requires each of the roles to award it; by default any one of them does.
- `all`: with more than one criterion, whether all must be met (Moodle's default) or any one. It's ignored with a single criterion. For a badge a teacher awards by hand whatever else it has, give `all: false`.

A criterion given replaces that kind's settings; `null` removes it; one not given stays. The other kinds of criteria a badge may have are left as they are. In the result, `courseCompletion.by` is an ISO date, and `all` is present only with more than one criterion.

It throws `BadgeError` when the person can't set criteria (it takes `moodle/badges:configurecriteria`), when the badge is enabled (disable it first) or locked because someone has it, and for activities or roles the criterion doesn't offer, naming them and those it does; `BadgesDisabledError` on a site with badges off.

## setBadgeEnabled

Enables or disables a badge, and returns it afterwards.

```ts
function setBadgeEnabled(context: BrowserContext, siteUrl: string, badgeId: number, enabled: boolean): Promise<{ changed: string; badge: CourseBadge }>;
```

Enabling awards it at once to whoever already meets its criteria (`recipients` afterwards counts them). A badge already in that state is left as it is: Moodle's service would otherwise lock an enabled badge enabled again. A disabled badge someone has keeps its recipients, and stays locked.

It throws `BadgeError` when the person can't (it takes `moodle/badges:configurecriteria`) or the badge has no criteria yet; `BadgesDisabledError` on a site with badges or course badges off.

## awardBadge

Awards a badge by hand to a participant, through its award page, and returns the badge afterwards.

```ts
function awardBadge(context: BrowserContext, siteUrl: string, badgeId: number, userId: number, options?: { roleId?: number }): Promise<{ changed: string; badge: CourseBadge }>;
```

The badge must be enabled and have a manual criterion naming a role the person holds in the course. The person awards it as that role; when the criterion names several they hold, Moodle asks which one, and `roleId` answers (the first otherwise). Moodle issues the badge when its criteria are met: at once when the manual award is enough (it's the only criterion, or any one earns it), else once the rest are met too (confirmed empirically, Moodle 5.2). A participant awarded it by hand already is left as is.

It throws `BadgeError` when the person can't award it (it takes `moodle/badges:awardbadge` and one of the criterion's roles), when the badge isn't enabled or has no manual criterion, and when Moodle doesn't award it to the user (not a participant it can be awarded to).

## Example

A teacher makes a badge for reading a page, which either completing the page or a teacher's award earns, enables it and awards it to a student who read it on paper.

```ts
import { BadgeError, BadgesDisabledError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const { badge } = await moodle.createBadge(3, { name: "Reader", description: "Read the course's introduction.", image: "/home/ana/badges/reader.png" });

  // 3: the editing teacher role on a standard site.
  const { criteria } = await moodle.setBadgeCriteria(badge.id, {
    activities: { activityIds: [42] },
    manual: { roleIds: [3] },
    all: false,
  });
  console.log(criteria);

  await moodle.setBadgeEnabled(badge.id, true);
  const awarded = await moodle.awardBadge(badge.id, 57);
  console.log(awarded.changed);

  for (const b of await moodle.courseBadges(3)) console.log(b.name, b.enabled ? "enabled" : "disabled", b.recipients);
} catch (error) {
  if (error instanceof BadgesDisabledError || error instanceof BadgeError) console.log(error.message);
  else throw error;
}
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `courseBadges`: `course-content`, `own` and `others-aggregate` (the badges teachers set up, whether the person has each, and how many have it).
- `createBadge`, `setBadgeCriteria`: `course-content`.
- `setBadgeEnabled`: `course-content` and `others-write` (enabling awards the badge to whoever meets its criteria).
- `awardBadge`: `others-write`.

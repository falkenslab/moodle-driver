# Course badges: list, create, set criteria, enable and award

Issue: [#65](https://github.com/falkenslab/moodle-driver/issues/65)

## Goal

A teacher manages a course's badges through the driver: reads them, creates one with its criteria, enables it and awards it by hand.

## Context

- Nothing in the driver reads or writes badges. Moodle's pages: `badges/view.php?type=2&id=<course>` (the course's badges), `badges/edit.php` and `newbadge.php` (details and image), `badges/criteria.php` and `criteria_settings.php` (criteria), the enable/disable action, `badges/award.php` (manual award), `badges/recipients.php`.
- moodle-mcp needs it (falkenslab/moodle-mcp#21).

## Changes

- `courseBadges(courseId)`: each badge's id, name, description, image URL, criteria, enabled or not, and how many people have it.
- `createBadge(courseId, { name, description, image })` (image: a local file), `setBadgeCriteria(badgeId, …)` for activity completion, course completion, manual award by role and grade, `setBadgeEnabled(badgeId, enabled)`, `awardBadge(badgeId, userId)` by hand.
- Errors naming a missing capability (`moodle/badges:createbadge`, `configurecriteria`, `awardbadge`) or a site where badges are disabled; data category course content (awarding: others' work); a new docs page for badges (both languages); fake-Moodle tests.

## Acceptance

- In the sandbox, in a scratch course: a badge created with an image, given an activity completion criterion and a manual one, enabled, awarded by hand to the student, read back with one recipient, and disabled again.

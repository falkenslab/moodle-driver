# Data categories

## Goal

Every public function declares which kinds of data it reads or writes, in one exported manifest, so consumers can decide what to allow (moodle-mcp's scopes, its ADR-015) without classifying the driver by hand.

## Context

- About 115 public functions: generic primitives (`callService`, `openSitePage`, the form helpers, `editCourse`, the manager's `tab()`) that reach anything; area functions; helpers that read others' data without a tool of their own (`userById`, `courseRoles`, `listParticipants`, `gradingPanelHtml`, `discussionPosts`, `readReview` of someone else's attempt).
- Half the pending cards touch others' data, and several mix categories within one area (gradebook: setup is content, the grader report isn't; completion: own, override, report): the category belongs to each function, declared when it's written.
- Do this card before the other pending ones, so they're born classified.

## Changes

- `src/categories.ts`, exported: `DataCategory` = `none` (session, site) | `own` (the person's own data) | `course-content` (made by teachers: structure, activities' content and settings, rubrics' definitions, questions) | `others-aggregate` (counts that identify no one) | `others-personal` (others' data or work: names, submissions, posts, attempts, responses, grades, roles) | `others-write` (deciding about others: grades, feedback, extensions, overrides, completion) | `communication` (writing to or before others: posts, messages) | `any` (generic primitives).
- `DATA_CATEGORIES: Record<string, DataCategory[]>`, one entry per public function, and for functions that read activities a per-module answer: `moduleCategories(module)` (teacher-authored modules → `course-content`; forum, glossary, wiki, data, workshop, chat, and responses to assign, quiz, feedback, questionnaire, choice, lesson, h5p → `others-personal` for a teacher).
- A test: every function exported from `src/index.ts` has an entry (it fails when a new one doesn't); entries name only exported functions.
- `core/conventions.md`: "Every public function declares its data categories in `src/categories.ts`."
- The pending cards' functions declare theirs when implemented (the test enforces it).

## Acceptance

- The manifest covers every public function; the test fails on an undeclared export.
- `assignmentSubmissions`, `gradeSubmission`, `replyToPost`, `userById`, `discussion` are not `course-content`; `createActivity`, `courseStructure`, `activityContent` (for page, book, label, url, resource, folder) are; `callService` and the form helpers are `any`.
- moodle-mcp can import `DATA_CATEGORIES` and `moduleCategories` from the package.

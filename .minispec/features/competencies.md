# Competencies: course competencies, links and ratings

Issue: [#82](https://github.com/falkenslab/moodle-driver/issues/82)

## Goal

A teacher reads a course's competencies, links them to the course and its activities, and rates participants in them.

## Context

- Nothing reads or writes competencies (backups leave them out).
- Moodle, to confirm on the sandbox: `admin/tool/lp/coursecompetencies.php?courseid=` and `core_competency_list_course_competencies`, `add_competency_to_course`, `remove_competency_from_course`; an activity's links through its settings form's competencies field (or `core_competency_add_competency_to_course_module`, where it exists); ratings through `user_competency_in_course.php` and `core_competency_grade_competency_in_course` (rating with a note as evidence). Frameworks are made at site level: the issue's title names them, but only reading them is asked.
- moodle-mcp needs it.

## Changes

- `courseCompetencies(courseId)`: each competency's id, short name, description, framework (id and name) and the activities linked to it.
- `addCourseCompetency(courseId, competencyId)`, `removeCourseCompetency(courseId, competencyId)`, and `setActivityCompetencies(activityId, competencyIds)` (or one link at a time; a choice to settle).
- `competencyRating(courseId, userId, competencyId)` (rating, proficient or not, evidence) and `rateCompetency(courseId, userId, competencyId, { rating, note? })`.
- Errors naming a missing capability (`moodle/competency:coursecompetencyview`, `coursecompetencymanage`, `competencygrade`) and competencies disabled on the site.
- Data categories: competencies and links `course-content`; a participant's rating `others-personal`, rating one `others-write`.
- A new docs page for competencies (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, where competencies are enabled: a framework's competency added to a scratch course and one of its activities, read back, and the student rated in it with a note.

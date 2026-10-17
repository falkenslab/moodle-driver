# Question banks on Moodle 4.x

Issue: [#87](https://github.com/falkenslab/moodle-driver/issues/87)

## Goal

The question bank functions work on Moodle 4.5, where each course has its own bank (`question/edit.php`), as they do on 5.x's bank activities.

## Context

- `src/areas/questions/` (`questionBanks`, `questions`, `questionCategories` and their writes, `createQuestion`/`updateQuestion` for every type (#85), `importQuestions`, `exportQuestions`, `moveQuestions`, `deleteQuestions`, `setQuestionStatus`) and quiz functions that take questions (`addQuestionsToQuiz`) assume Moodle 5's `qbank` activities: a bank is a course module id. On 4.5 `question/banks.php` doesn't exist (now a `not-found` naming it) and banks are the course's (and its categories', the system's) question contexts.
- The real 4.5 test course has a course bank on `question/edit.php?courseid=…` and every question type plugin the 5.2 sandbox lacks (CodeRunner, Formulas, Gap fill, drag and drop matching), so #85's plugin types can be checked there.
- Depends on `moodle-versions` (the detected version decides the path).

## Changes

- On 4.x, `questionBanks(courseId)` gives the course's bank (and the shared ones the person can use: category and system contexts) with an id the other functions take; the same functions then work through 4.x's pages (`question/edit.php`, `question/bank/managecategories/category.php`, `question/bank/importquestions/import.php`, `question/bank/exportquestions/export.php`, `question/bank/editquestion/question.php`), keeping their signatures and results.
- What a 4.x bank can't do is refused with `not-available` naming the version; the docs say which ids a program passes on each version.
- Fake-Moodle tests with 4.5's pages; the questions sandbox file passes on the 4.5 sandbox.

## Acceptance

- On a 4.5 sandbox, the questions sandbox file passes, its checks running on the course bank.
- On the real 4.5 test course, a "Driver check" category in the course bank gets one question of each plugin type the site has (CodeRunner, Formulas, Gap fill, drag and drop matching), each previewed, changed and deleted with the category: nothing left in the course.

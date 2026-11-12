// The Moodle page that shows each method's result: what a creation made (not the form that made
// it), the item an edit changed, the page a read reads. While the person watches, the Moodle object's
// methods leave it in the working tab after the call (ADR-007); a program can link to it headless.
import type { DefaultedMethod, Moodle } from "./client.js";
import type { MoodleMethods } from "./moodle-methods.generated.js";

/** A method of the `Moodle` object that runs one of the driver's functions. */
type Method = keyof MoodleMethods | DefaultedMethod;

/** A method's page, relative to the site, from the arguments it was called with and what it returned; `undefined` when there's none to show. */
type PageOf<K extends Method> = (args: Parameters<Moodle[K]>, result: Awaited<ReturnType<Moodle[K]>>) => string | undefined;

const course = (courseId: number) => `course/view.php?id=${courseId}`;
const upcoming = (courseId?: number) => `calendar/view.php?view=upcoming${courseId ? `&course=${courseId}` : ""}`;
// An event's day in the calendar, where it's shown.
const eventDay = (event: { start: string; courseId?: number }) => `calendar/view.php?view=day&time=${Math.floor(Date.parse(event.start) / 1000)}${event.courseId ? `&course=${event.courseId}` : ""}`;
const gradebookSetup = (courseId: number) => `grade/edit/tree/index.php?id=${courseId}`;
const courseCompetencies = (courseId: number) => `admin/tool/lp/coursecompetencies.php?courseid=${courseId}`;
const notifications = () => "message/output/popup/notifications.php";

// An activity's own page from its module; a label (and a subsection) has none of its own worth showing: the course page at it.
const activityPage = (module: string, id: number, courseId?: number) =>
  (module === "label" || module === "subsection") && courseId ? `course/view.php?id=${courseId}#module-${id}` : `mod/${module}/view.php?id=${id}`;
// The module of an activity in a CourseChange's sections.
const moduleIn = (sections: { activities: { id: number; type: string }[] }[], id: number) => sections.flatMap((s) => s.activities).find((a) => a.id === id)?.type;
const book = (activityId: number, chapterId?: number) => `mod/book/view.php?id=${activityId}${chapterId ? `&chapterid=${chapterId}` : ""}`;
const assignmentGrading = (activityId: number) => `mod/assign/view.php?id=${activityId}&action=grading`;
const assignment = (activityId: number) => `mod/assign/view.php?id=${activityId}`;
const bigBlueButtonPage = (activityId: number) => `mod/bigbluebuttonbn/view.php?id=${activityId}`;
const completionCriteria = (courseId: number) => `course/completion.php?id=${courseId}`;
const courseTools = (courseId: number) => `mod/lti/coursetools.php?id=${courseId}`;
// A course's content bank goes by the course's context id, which only a content's file URL tells (pluginfile.php/<context>/contentbank/…).
const bankContext = (fileUrl?: string) => (fileUrl ? /\/pluginfile\.php\/(\d+)\/contentbank\//.exec(fileUrl)?.[1] : undefined);
const database = (activityId: number, page = "view.php") => `mod/data/${page}${page.includes("?") ? "&" : "?"}id=${activityId}`;
// An entry's single view: view.php takes the entry alone (`rid`, its database from it); with `id` too it ignores `rid` and shows the list.
const databaseEntry = (entryId: number) => `mod/data/view.php?rid=${entryId}`;
// The templates page that edits each template (as MOODLE_TEMPLATES in areas/databases/templates.ts, not exported).
const templateMode = (template: string) =>
  ({ list: "listtemplate", listHeader: "listtemplate", listFooter: "listtemplate", single: "singletemplate", add: "addtemplate", search: "asearchtemplate", rss: "rsstemplate", rssTitle: "rsstemplate", css: "csstemplate", js: "jstemplate" })[template] ?? "listtemplate";
const forum = (activityId: number) => `mod/forum/view.php?id=${activityId}`;
const discussionPage = (discussionId: number, postId?: number) => `mod/forum/discuss.php?d=${discussionId}${postId ? `#p${postId}` : ""}`;
const glossary = (activityId: number, query?: string) => `mod/glossary/view.php?id=${activityId}${query ? `&${query}` : ""}`;
const glossaryEntry = (activityId: number, entryId: number) => glossary(activityId, `mode=entry&hook=${entryId}`);
const lessonEdit = (activityId: number) => `mod/lesson/edit.php?id=${activityId}`;
// The lesson where the person is: a real page by its id (Moodle's own "Continue" goes to view.php?id=&pageid=); the end (-9) and jumps (<= 0) not, as opening the end again would end the attempt.
const lesson = (activityId: number, pageId?: number) => `mod/lesson/view.php?id=${activityId}${pageId && pageId > 0 ? `&pageid=${pageId}` : ""}`;
const feedbackEdit = (activityId: number) => `mod/feedback/edit.php?id=${activityId}`;
const feedbackTemplatesPage = (activityId: number) => `mod/feedback/manage_templates.php?id=${activityId}`;
const wikiPageOf = (pageId: number) => `mod/wiki/view.php?pageid=${pageId}`;
const workshop = (cmid: number) => `mod/workshop/view.php?id=${cmid}`;
// The allocation page: the manual allocator's table by default, `method=scheduled` its scheduled allocation form.
const workshopAllocationPage = (cmid: number, method?: "scheduled") => `mod/workshop/allocation.php?cmid=${cmid}${method ? `&method=${method}` : ""}`;
const workshopSubmissionPage = (cmid: number, submissionId: number) => `mod/workshop/submission.php?cmid=${cmid}&id=${submissionId}`;
const workshopExamplePage = (cmid: number, exampleId: number) => `mod/workshop/exsubmission.php?cmid=${cmid}&id=${exampleId}`;
const workshopFormPage = (cmid: number) => `mod/workshop/editform.php?cmid=${cmid}`;
const attendanceSessionsPage = (activityId: number) => `mod/attendance/manage.php?id=${activityId}`;
const board = (activityId: number) => `mod/board/view.php?id=${activityId}`;
const questionnaireQuestionsPage = (activityId: number) => `mod/questionnaire/questions.php?id=${activityId}`;
const offlineQuizEdit = (activityId: number, group: number) => `mod/offlinequiz/edit.php?cmid=${activityId}&groupnumber=${group}`;

const grader = (courseId: number) => `grade/report/grader/index.php?id=${courseId}`;
const scales = (courseId: number) => `grade/edit/scale/index.php?id=${courseId}`;
const participantsPage = (courseId: number) => `user/index.php?id=${courseId}`;
const groupsOverview = (courseId: number, groupingId?: number) => `group/overview.php?id=${courseId}${groupingId ? `&grouping=${groupingId}` : ""}`;
const enrolmentMethodsPage = (courseId: number) => `enrol/instances.php?id=${courseId}`;
const notesPage = (courseId: number, userId?: number) => `notes/index.php?course=${courseId}${userId ? `&user=${userId}` : ""}`;
// A question's preview: by the question's id alone, the same page on 4.5 and 5.x (a bank's own pages
// go by the qbank's cmid on 5.x and by the course's id on 4.x, which a bank id can't tell).
const questionPreview = (questionId: number) => `question/bank/previewquestion/preview.php?id=${questionId}`;
const quiz = (activityId: number) => `mod/quiz/view.php?id=${activityId}`;
const quizEdit = (activityId: number) => `mod/quiz/edit.php?cmid=${activityId}`;
const quizReport = (activityId: number, mode: string) => `mod/quiz/report.php?id=${activityId}&mode=${mode}`;
// An attempt's review; when the quiz doesn't let the person review it yet, Moodle sends them back to the quiz's page with why.
const attemptReview = (attemptId: number) => `mod/quiz/review.php?attempt=${attemptId}&showall=1`;
// Where an attempt call left it: the page shown, or its summary once past the last page.
const attemptPage = ({ attemptId, page }: { attemptId: number; page?: number }) =>
  page === undefined ? `mod/quiz/summary.php?attempt=${attemptId}` : `mod/quiz/attempt.php?attempt=${attemptId}&page=${page}`;
/**
 * The page that shows each method's result, a path relative to the site built from the call's
 * arguments and what it returned: what a creation made (`createActivity`: the new activity, not the
 * form that made it), the item an edit changed or the page that lists it, the page a read reads, the
 * attempt or submission a student action left. The same paths on Moodle 4.5 and 5.x. While the
 * browser is shown, the `Moodle` object's methods leave it in the working tab after the call; headed
 * or headless, a program can link the person to `new URL(FOLLOWED_PAGES.name(args, result), site)`.
 * `undefined` when a call has nothing to show; `UNFOLLOWED_METHODS` lists the methods that never do.
 */
export const FOLLOWED_PAGES: { readonly [K in Method]?: PageOf<K> } = {
  // Site and people.
  whoAmI: () => "user/profile.php",
  userById: ([userId]) => `user/profile.php?id=${userId}`,
  // Courses.
  listCourses: () => "my/courses.php",
  courseStructure: ([courseId]) => course(courseId),
  pendingActivities: ([courseId]) => course(courseId),
  listAssignments: ([courseId]) => `mod/assign/index.php?id=${courseId}`,
  activitiesOverview: ([courseId]) => `course/overview.php?id=${courseId}`,
  courseUpdates: ([courseId]) => course(courseId),
  deadlines: ([options]) => upcoming(options?.courseId),
  // Building a course.
  editActivity: ([courseId]) => course(courseId),
  duplicateActivity: ([courseId]) => course(courseId),
  deleteActivity: ([courseId]) => course(courseId),
  addSection: ([courseId]) => course(courseId),
  editSection: ([courseId]) => course(courseId),
  deleteSection: ([courseId]) => course(courseId),
  // Forums.
  discussion: ([discussionId]) => `mod/forum/discuss.php?d=${discussionId}`,
  setDiscussionState: ([activityId]) => `mod/forum/view.php?id=${activityId}`,
  // Assignments.
  assignmentSubmissions: ([activityId]) => `mod/assign/view.php?id=${activityId}&action=grading`,
  gradeSubmission: ([activityId, userId]) => `mod/assign/view.php?id=${activityId}&action=grader&userid=${userId}`,
  rubric: ([activityId]) => `mod/assign/view.php?id=${activityId}`,
  // Participants and groups.
  participants: ([courseId]) => `user/index.php?id=${courseId}`,
  setUserRoles: ([courseId]) => `user/index.php?id=${courseId}`,
  groups: ([courseId]) => `group/index.php?id=${courseId}`,
  // Completion, badges and competencies.
  completionReport: ([courseId]) => `report/progress/index.php?course=${courseId}`,
  setBadgeEnabled: ([badgeId]) => `badges/overview.php?id=${badgeId}`,
  competencyFrameworks: ([courseId]) => courseCompetencies(courseId),
  courseCompetencies: ([courseId]) => courseCompetencies(courseId),
  addCourseCompetency: ([courseId]) => courseCompetencies(courseId),
  removeCourseCompetency: ([courseId]) => courseCompetencies(courseId),
  competencyRating: ([courseId, userId, competencyId]) => `admin/tool/lp/user_competency_in_course.php?courseid=${courseId}&competencyid=${competencyId}&userid=${userId}`,
  rateCompetency: ([courseId, userId, competencyId]) => `admin/tool/lp/user_competency_in_course.php?courseid=${courseId}&competencyid=${competencyId}&userid=${userId}`,
  // The gradebook.
  updateGradeItem: ([courseId]) => gradebookSetup(courseId),
  addGradeCategory: ([courseId]) => gradebookSetup(courseId),
  // Notifications and messages.
  notifications,
  markNotificationsRead: notifications,
  conversations: () => "message/index.php",
  conversation: ([conversationId]) => `message/index.php?convid=${conversationId}`,
  sendMessage: ([userId]) => `message/index.php?id=${userId}`,
  // The calendar.
  upcomingEvents: ([options]) => upcoming(options?.courseId),
  calendarEvent: (_, event) => eventDay(event),
  createEvent: (_, { event }) => eventDay(event),
  updateEvent: (_, { event }) => eventDay(event),
  deleteEvent: () => upcoming(),
  // The content bank.
  renameContent: ([contentId]) => `contentbank/view.php?id=${contentId}`,
  // Books.
  bookChapters: ([activityId]) => book(activityId),
  addBookChapter: ([activityId], { chapterId }) => book(activityId, chapterId),
  editBookChapter: ([activityId, chapterId]) => book(activityId, chapterId),
  moveBookChapter: ([activityId, chapterId]) => book(activityId, chapterId),
  setBookChapterVisible: ([activityId, chapterId]) => book(activityId, chapterId),
  // A deleted chapter: the book, its table of contents.
  deleteBookChapter: ([activityId]) => book(activityId),
  // Building a course (activities).
  activitySettings: (_, { id, module, courseId }) => activityPage(module, id, courseId),
  // What it made, its module the type asked for (a qbank's id is the bank's, mod/qbank/view.php, Moodle 5 only as the function is); none made: the course.
  createActivity: ([input], { activityId }) => (activityId ? activityPage(input.type, activityId, input.courseId) : course(input.courseId)),
  // The module from the course structure the result carries; a label's course from its section's activities isn't given, so a label goes to mod/label/view.php, which redirects to its course.
  updateActivity: ([activityId], { sections }) => {
    const module = moduleIn(sections, activityId);
    return module ? activityPage(module, activityId) : undefined;
  },
  activityContent: (_, { activity }) => activityPage(activity.type, activity.id),
  // Assignments.
  // The assignment: the advanced grading page (grade/grading/manage.php) wants the context or area id, which neither args nor result give; as rubric does.
  setGradingDefinition: ([activityId]) => assignment(activityId),
  allocateMarker: ([activityId]) => assignmentGrading(activityId),
  grantExtension: ([activityId]) => assignmentGrading(activityId),
  setWorkflowState: ([activityId]) => assignmentGrading(activityId),
  // A student's: their submission's status, on the assignment's page.
  studentAssignment: ([activityId]) => assignment(activityId),
  saveSubmission: ([activityId]) => assignment(activityId),
  submitForGrading: ([activityId]) => assignment(activityId),
  // Backup, copy and restore.
  copyCourse: (_, { course: made }) => course(made.id),
  importActivities: ([, toCourseId]) => course(toCourseId),
  restoreCourse: (_, { course: restored }) => course(restored.id),
  // Badges.
  courseBadges: ([courseId]) => `badges/index.php?type=2&id=${courseId}`,
  createBadge: (_, { badge }) => `badges/overview.php?id=${badge.id}`,
  setBadgeCriteria: ([badgeId]) => `badges/criteria.php?id=${badgeId}`,
  awardBadge: ([badgeId]) => `badges/recipients.php?id=${badgeId}`,
  // BigBlueButton.
  bigBlueButton: ([activityId]) => bigBlueButtonPage(activityId),
  // The join URL starts or joins the meeting when opened: the activity's page instead.
  bigBlueButtonJoinUrl: ([activityId]) => bigBlueButtonPage(activityId),
  // The recordings are listed on the activity's page.
  setRecordingPublished: ([activityId]) => bigBlueButtonPage(activityId),
  deleteRecording: ([activityId]) => bigBlueButtonPage(activityId),
  // Course completion.
  courseCompletionCriteria: ([courseId]) => completionCriteria(courseId),
  setCourseCompletionCriteria: ([courseId]) => completionCriteria(courseId),
  courseCompletionStatus: ([courseId]) => `report/completion/index.php?course=${courseId}`,
  // The person's completion details for the course (the completion status block's page, which needs no block in the course).
  markCourseComplete: ([courseId, userId]) => `blocks/completionstatus/details.php?course=${courseId}&user=${userId}`,
  // Blocks: on the course page, each block's element is #inst<id>.
  courseBlocks: ([courseId]) => course(courseId),
  addBlock: ([courseId], { block }) => `${course(courseId)}#inst${block.id}`,
  configureBlock: ([courseId, blockId]) => `${course(courseId)}#inst${blockId}`,
  moveBlock: ([courseId, blockId]) => `${course(courseId)}#inst${blockId}`,
  deleteBlock: ([courseId]) => course(courseId),
  // Courses.
  updateCourse: ([courseId]) => course(courseId),
  resetCourse: ([courseId]) => course(courseId),
  // The content bank and H5P.
  // The bank's page takes the course's context id, read from a content's file URL; an empty bank (or no file URL) has no page that can be told.
  contentBank: (_, contents) => {
    const contextId = bankContext(contents.find((c) => c.fileUrl)?.fileUrl);
    return contextId ? `contentbank/index.php?contextid=${contextId}` : undefined;
  },
  uploadToContentBank: (_, { content }) => `contentbank/view.php?id=${content.id}`,
  h5pActivity: ([activityId]) => `mod/h5pactivity/view.php?id=${activityId}`,
  // External tools (LTI): the course's tools page (mod/lti/coursetools.php, Moodle 4.3 and later).
  externalTools: ([courseId]) => courseTools(courseId),
  addExternalTool: ([courseId]) => courseTools(courseId),
  setExternalToolInChooser: ([courseId]) => courseTools(courseId),
  deleteExternalTool: ([courseId]) => courseTools(courseId),
  // The launch URL launches the tool (and logs a view) when opened: the activity's page instead.
  externalToolLaunchUrl: ([activityId]) => `mod/lti/view.php?id=${activityId}`,
  // SCORM.
  scorm: ([activityId]) => `mod/scorm/view.php?id=${activityId}`,
  // Site and people.
  // The person's profile in the course, which lists their roles there.
  courseRoles: ([userId, courseId]) => `user/view.php?id=${userId}&course=${courseId}`,
  // Reports.
  activityReport: ([courseId]) => `report/outline/index.php?id=${courseId}`,
  courseLogs: ([courseId, options]) =>
    `report/log/index.php?id=${courseId}&chooselog=1${options?.userId ? `&user=${options.userId}` : ""}${options?.activityId ? `&modid=${options.activityId}` : ""}`,
  // The report shows rows only for a role: with none given, its page for the activity, where the person picks one.
  participationReport: ([courseId, activityId, options]) => `report/participation/index.php?id=${courseId}&instanceid=${activityId}${options?.roleId ? `&roleid=${options.roleId}` : ""}`,
  // Ratings: the rated item's page, with its rating (as ratings.ts's itemPage).
  rate: ([item]) =>
    item.type === "forum-post" ? `mod/forum/discuss.php?d=${item.discussionId}#p${item.id}` : item.type === "glossary-entry" ? `mod/glossary/showentry.php?eid=${item.id}` : `mod/data/view.php?rid=${item.id}`,
  // Messages: one recipient, the conversation with them; several, the participants page they were chosen from.
  messageParticipants: ([courseId], { sentTo }) => (sentTo.length === 1 ? `message/index.php?id=${sentTo[0]}` : `user/index.php?id=${courseId}`),
  // Databases.
  databaseEntries: ([activityId]) => database(activityId),
  addDatabaseEntry: (_, { entryId }) => databaseEntry(entryId),
  editDatabaseEntry: ([, entryId]) => databaseEntry(entryId),
  setDatabaseEntryApproved: ([, entryId]) => databaseEntry(entryId),
  deleteDatabaseEntry: ([activityId]) => database(activityId),
  importDatabaseEntries: ([activityId]) => database(activityId),
  databaseFields: ([activityId]) => database(activityId, "field.php"),
  addDatabaseField: ([activityId]) => database(activityId, "field.php"),
  editDatabaseField: ([activityId]) => database(activityId, "field.php"),
  deleteDatabaseField: ([activityId]) => database(activityId, "field.php"),
  databaseTemplates: ([activityId]) => database(activityId, "templates.php?mode=listtemplate"),
  setDatabaseTemplate: ([activityId, template]) => database(activityId, `templates.php?mode=${templateMode(template)}`),
  databasePresets: ([activityId]) => database(activityId, "preset.php"),
  applyDatabasePreset: ([activityId]) => database(activityId, "field.php"),
  // Forums.
  forumDiscussions: ([activityId]) => forum(activityId),
  startDiscussion: ([activityId], { discussionId }) => (discussionId ? discussionPage(discussionId) : forum(activityId)),
  replyToPost: (_, { discussionId, postId }) => (discussionId ? discussionPage(discussionId, postId) : undefined),
  // A discussion's first post takes the discussion with it: its forum isn't known then.
  deletePost: (_, { discussionId, discussionDeleted }) => (discussionId && !discussionDeleted ? discussionPage(discussionId) : undefined),
  setDiscussionSubscription: ([, discussionId]) => discussionPage(discussionId),
  // The forum's "Grade users" grader opens from its page.
  forumGrades: ([activityId]) => forum(activityId),
  gradeForumUser: ([activityId]) => forum(activityId),
  // Glossaries.
  glossaryEntries: ([activityId, options]) =>
    glossary(activityId, options?.search ? `mode=search&fullsearch=1&hook=${encodeURIComponent(options.search.trim())}` : `mode=${options?.pending ? "approval" : "letter"}&hook=${encodeURIComponent(options?.letter?.toUpperCase() ?? "ALL")}`),
  addGlossaryEntry: ([activityId], { entryId }) => glossaryEntry(activityId, entryId),
  editGlossaryEntry: ([activityId, entryId]) => glossaryEntry(activityId, entryId),
  setGlossaryEntryApproved: ([activityId, entryId]) => glossaryEntry(activityId, entryId),
  deleteGlossaryEntry: ([activityId]) => glossary(activityId),
  importGlossaryEntries: ([activityId]) => glossary(activityId),
  // hook=0 is every category (GLOSSARY_SHOW_ALL_CATEGORIES); a category's id, its entries.
  glossaryCategories: ([activityId]) => glossary(activityId, "mode=cat&hook=0"),
  addGlossaryCategory: ([activityId], { categoryId }) => glossary(activityId, `mode=cat&hook=${categoryId}`),
  // Lessons.
  lessonPage: ([activityId], page) => lesson(activityId, page.kind === "end" ? undefined : page.pageId),
  answerLessonPage: ([activityId], { page }) => lesson(activityId, page.kind === "end" ? undefined : page.pageId),
  lessonPages: ([activityId]) => lessonEdit(activityId),
  addLessonPage: ([activityId]) => lessonEdit(activityId),
  editLessonPage: ([activityId]) => lessonEdit(activityId),
  moveLessonPage: ([activityId]) => lessonEdit(activityId),
  deleteLessonPage: ([activityId]) => lessonEdit(activityId),
  // Surveys: choices, feedback and questionnaires.
  getChoice: ([activityId]) => `mod/choice/view.php?id=${activityId}`,
  answerChoice: ([activityId]) => `mod/choice/view.php?id=${activityId}`,
  choiceResults: ([activityId]) => `mod/choice/report.php?id=${activityId}`,
  // Without the type, its module isn't known (the function asks the site for it).
  getSurvey: ([activityId, type]) => (type ? `mod/${type}/view.php?id=${activityId}` : undefined),
  // Two forms: (activityId, type, responses) or (activityId, responses, { type }); Parameters<> gives the last. The activity's page says it's completed.
  submitSurvey: ([activityId, second, options]) => {
    const type = typeof second === "string" ? (second as unknown as string) : options?.type;
    return type ? `mod/${type}/view.php?id=${activityId}` : undefined;
  },
  // A feedback's responses; a questionnaire's report takes its instance id, which the result doesn't carry: its page links to it.
  surveyResults: ([activityId], { type }) => (type === "feedback" ? `mod/feedback/show_entries.php?id=${activityId}` : `mod/questionnaire/view.php?id=${activityId}`),
  feedbackItems: ([activityId]) => feedbackEdit(activityId),
  addFeedbackItem: ([activityId]) => feedbackEdit(activityId),
  editFeedbackItem: ([activityId]) => feedbackEdit(activityId),
  moveFeedbackItem: ([activityId]) => feedbackEdit(activityId),
  deleteFeedbackItem: ([activityId]) => feedbackEdit(activityId),
  useFeedbackTemplate: ([activityId]) => feedbackEdit(activityId),
  feedbackTemplates: ([activityId]) => feedbackTemplatesPage(activityId),
  saveFeedbackTemplate: ([activityId]) => feedbackTemplatesPage(activityId),
  deleteFeedbackTemplate: ([activityId]) => feedbackTemplatesPage(activityId),
  // Wikis.
  // The subwiki's page list (map.php option 5) from a page of it; none listed, the wiki's page.
  wikiPages: ([activityId], result) => {
    const first = (Array.isArray(result) ? result : result.items)[0];
    return first ? `mod/wiki/map.php?pageid=${first.id}&option=5` : `mod/wiki/view.php?id=${activityId}`;
  },
  wikiPage: ([, pageId, options]) => (options?.history ? `mod/wiki/history.php?pageid=${pageId}` : wikiPageOf(pageId)),
  createWikiPage: (_, { pageId }) => wikiPageOf(pageId),
  editWikiPage: ([, pageId]) => wikiPageOf(pageId),
  // The gradebook.
  gradebookSetup: ([courseId]) => gradebookSetup(courseId),
  addGradeItem: ([courseId]) => gradebookSetup(courseId),
  updateGradeCategory: ([courseId]) => gradebookSetup(courseId),
  deleteGradeItem: ([courseId]) => gradebookSetup(courseId),
  deleteGradeCategory: ([courseId]) => gradebookSetup(courseId),
  graderReport: ([courseId, options]) => `${grader(courseId)}${options?.group ? `&group=${options.group}` : ""}`,
  // A preview writes nothing: its page is the import form itself.
  importGrades: ([courseId], result) => (result.imported ? grader(courseId) : undefined),
  setGrade: ([courseId, , userId]) => `grade/report/singleview/index.php?id=${courseId}&item=user&itemid=${userId}`,
  myGrades: ([courseId]) => `grade/report/user/index.php?id=${courseId}`,
  courseScales: ([courseId]) => scales(courseId),
  addScale: ([courseId]) => scales(courseId),
  editScale: ([courseId]) => scales(courseId),
  // Participants and groups.
  participantFilters: ([courseId]) => participantsPage(courseId),
  enrolUsers: ([courseId]) => participantsPage(courseId),
  unenrolUser: ([courseId]) => participantsPage(courseId),
  enrolmentMethods: ([courseId]) => enrolmentMethodsPage(courseId),
  setEnrolmentMethod: ([courseId]) => enrolmentMethodsPage(courseId),
  createGroup: ([courseId], { groupId }) => `group/index.php?id=${courseId}&group=${groupId}`,
  setGroupMembers: ([groupId]) => `group/members.php?group=${groupId}`,
  // A preview writes nothing.
  autoCreateGroups: ([courseId, options], result) => (options.preview ? undefined : groupsOverview(courseId, "groupingId" in result ? result.groupingId : undefined)),
  importGroups: ([courseId]) => `group/index.php?id=${courseId}`,
  groupings: ([courseId]) => `group/groupings.php?id=${courseId}`,
  createGrouping: ([courseId]) => `group/groupings.php?id=${courseId}`,
  setGroupingGroups: ([groupingId]) => `group/assign.php?id=${groupingId}`,
  notes: ([courseId, options]) => notesPage(courseId, options?.userId),
  addNote: ([courseId, userId]) => notesPage(courseId, userId),
  editNote: (_, { note }) => (note ? notesPage(note.courseId, note.userId) : undefined),
  // Question banks: by the question, the only page the same on 4.5 and 5.x.
  questionBanks: ([courseId], banks) => (banks[0]?.type === "course" ? `question/edit.php?courseid=${courseId}` : `question/banks.php?courseid=${courseId}`),
  createQuestion: (_, { questionId }) => (questionId ? questionPreview(questionId) : undefined),
  updateQuestion: ([, questionId], result) => questionPreview(result.questionId ?? questionId),
  // The first question imported (several imported: the others aren't shown).
  importQuestions: (_, { questions }) => (questions[0] ? questionPreview(questions[0].id) : undefined),
  // Quizzes.
  quizInfo: ([activityId]) => quiz(activityId),
  startQuizAttempt: (_, result) => attemptPage(result),
  readAttempt: (_, result) => attemptPage(result),
  // Needs MoodleMethods to include the hand-bound methods (DEFAULTED in src/client.ts): it isn't in moodle-methods.generated.ts.
  answerQuizQuestions: (_, result) => attemptPage(result),
  finishQuizAttempt: ([attemptId]) => attemptReview(attemptId),
  readReview: ([attemptId]) => attemptReview(attemptId),
  gradeQuizQuestion: ([attemptId]) => attemptReview(attemptId),
  setQuizOverride: ([activityId]) => `mod/quiz/overrides.php?cmid=${activityId}&mode=user`,
  questionsToGrade: ([activityId]) => quizReport(activityId, "grading"),
  quizResults: ([activityId, options]) => quizReport(activityId, options?.responses ? "responses" : "overview"),
  quizStatistics: ([activityId]) => quizReport(activityId, "statistics"),
  quizStructure: ([activityId]) => quizEdit(activityId),
  addQuestionsToQuiz: ([activityId]) => quizEdit(activityId),
  addQuizSection: ([activityId]) => quizEdit(activityId),
  editQuizSlot: ([activityId]) => quizEdit(activityId),
  removeQuizSlot: ([activityId]) => quizEdit(activityId),
  setQuizPages: ([activityId]) => quizEdit(activityId),
  // Workshops.
  workshopInfo: ([activityId]) => workshop(activityId),
  setWorkshopPhase: ([activityId]) => workshop(activityId),
  // The person's own assessment, on its page (assessment.php, where assessWorkshopSubmission fills it).
  assessWorkshopSubmission: (_, { assessmentId }) => `mod/workshop/assessment.php?asid=${assessmentId}`,
  // Workshop allocation.
  workshopAllocation: ([activityId]) => workshopAllocationPage(activityId),
  allocateReviewer: ([activityId]) => workshopAllocationPage(activityId),
  removeReviewer: ([activityId]) => workshopAllocationPage(activityId),
  allocateRandomly: ([activityId]) => workshopAllocationPage(activityId),
  scheduleAllocation: ([activityId]) => workshopAllocationPage(activityId, "scheduled"),
  // Workshop grades: the report with the grades on the workshop's page; an override, the submission or assessment overridden.
  calculateWorkshopGrades: ([activityId]) => workshop(activityId),
  overrideWorkshopGrade: ([activityId, { submissionId, assessmentId }]) => (submissionId !== undefined ? workshopSubmissionPage(activityId, submissionId) : `mod/workshop/assessment.php?asid=${assessmentId}`),
  // Workshop examples: listed on the workshop's page (setup phase); each on exsubmission.php, its assessments on exassessment.php.
  workshopExamples: ([activityId]) => workshop(activityId),
  addWorkshopExample: ([activityId], { exampleId }) => workshopExamplePage(activityId, exampleId),
  editWorkshopExample: ([activityId, exampleId]) => workshopExamplePage(activityId, exampleId),
  deleteWorkshopExample: ([activityId]) => workshop(activityId),
  assessWorkshopExample: (_, { assessmentId }) => `mod/workshop/exassessment.php?asid=${assessmentId}`,
  // Workshop submissions: the submission's page (the workshop's page when the person has none).
  workshopSubmission: ([activityId], submission) => (submission ? workshopSubmissionPage(activityId, submission.id) : workshop(activityId)),
  saveWorkshopSubmission: ([activityId], { submissionId }) => workshopSubmissionPage(activityId, submissionId),
  // A workshop's assessment form: its edit page, the same for every grading strategy.
  workshopForm: ([activityId]) => workshopFormPage(activityId),
  setWorkshopForm: ([activityId]) => workshopFormPage(activityId),
  // Attendance: the sessions page (its remembered view, left as the person had it); the report its summary.
  // Taking attendance shows the sessions page too: a session's take page needs its group, which the call doesn't give.
  attendanceSessions: ([activityId]) => attendanceSessionsPage(activityId),
  addAttendanceSessions: ([activityId]) => attendanceSessionsPage(activityId),
  editAttendanceSession: ([activityId]) => attendanceSessionsPage(activityId),
  deleteAttendanceSession: ([activityId]) => attendanceSessionsPage(activityId),
  sessionAttendance: ([activityId]) => attendanceSessionsPage(activityId),
  takeAttendance: ([activityId]) => attendanceSessionsPage(activityId),
  attendanceReport: ([activityId, options]) => `mod/attendance/report.php?id=${activityId}&view=7${options?.groupId ? `&group=${options.groupId}` : ""}`,
  // A board's columns: the board itself.
  boardColumns: ([activityId]) => board(activityId),
  setBoardColumns: ([activityId]) => board(activityId),
  addBoardColumn: ([activityId]) => board(activityId),
  editBoardColumn: ([activityId]) => board(activityId),
  removeBoardColumn: ([activityId]) => board(activityId),
  // A questionnaire's questions: its questions page.
  questionnaireQuestions: ([activityId]) => questionnaireQuestionsPage(activityId),
  addQuestionnaireQuestions: ([activityId]) => questionnaireQuestionsPage(activityId),
  // An offline quiz: a group's edit page (group A to read them all); its forms, the forms page.
  offlineQuizGroups: ([activityId]) => offlineQuizEdit(activityId, 1),
  addQuestionsToOfflineQuiz: ([activityId, { group }]) => offlineQuizEdit(activityId, group ?? 1),
  createOfflineQuizForms: ([activityId]) => `mod/offlinequiz/createquiz.php?id=${activityId}&mode=createpdfs`,
};

/**
 * The methods with no page that shows their result: a file they save (`backupCourse`, `exportGrades`),
 * a value with no page of its own (the site's name, its version), a page the program works in itself
 * (`openSitePage`), or a page their arguments and result can't tell: a question bank's, which goes
 * by a qbank's id on Moodle 5 and a course's on 4.x; a group's or a note's, without its course.
 */
export const UNFOLLOWED_METHODS: readonly Method[] = ["siteName", "courseAbilities", "courseActivityTypes", "setCompletion", "overrideCompletion", "setQuestionStatus", "deleteContent", "backupCourse", "h5pContentTypes", "exportDatabaseEntries", "exportGrades", "downloadContent", "downloadFile", "setActivityCompetencies", "logOut", "moodleVersion", "openForm", "openSitePage", "exportGlossaryEntries", "editPost", "exportQuestions", "gradeLetters", "setGradeLetters", "potentialUsers", "updateGroup", "deleteGroup", "deleteGrouping", "deleteNote", "questions", "questionTypes", "deleteQuestions", "questionCategories", "addQuestionCategory", "editQuestionCategory", "deleteQuestionCategory", "moveQuestions"];

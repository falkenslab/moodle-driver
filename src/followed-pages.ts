// The Moodle page that shows a function's work, for the functions that may open none of their own
// (they work through AJAX services): while the person watches, the Moodle object's methods leave it
// in the working tab after the call (ADR-007), as functions that open a page already do.
import type { MoodleMethods } from "./moodle-methods.generated.js";

/** A method's page, relative to the site, from the arguments it was called with and what it returned; `undefined` when there's none to show. */
type PageOf<K extends keyof MoodleMethods> = (args: Parameters<MoodleMethods[K]>, result: Awaited<ReturnType<MoodleMethods[K]>>) => string | undefined;

const course = (courseId: number) => `course/view.php?id=${courseId}`;
const upcoming = (courseId?: number) => `calendar/view.php?view=upcoming${courseId ? `&course=${courseId}` : ""}`;
// An event's day in the calendar, where it's shown.
const eventDay = (event: { start: string; courseId?: number }) => `calendar/view.php?view=day&time=${Math.floor(Date.parse(event.start) / 1000)}${event.courseId ? `&course=${event.courseId}` : ""}`;
const gradebookSetup = (courseId: number) => `grade/edit/tree/index.php?id=${courseId}`;
const courseCompetencies = (courseId: number) => `admin/tool/lp/coursecompetencies.php?courseid=${courseId}`;
const notifications = () => "message/output/popup/notifications.php";

/**
 * The page that shows each method's work, for the methods that may open no page of their own: the
 * course page after `courseStructure` or `editActivity`, the discussion after `discussion`, the grader
 * after `gradeSubmission`… The same paths on Moodle 4.5 and 5.x. A program that calls the functions
 * itself can show `new URL(FOLLOWED_PAGES.name(args, result), site)` the same way.
 */
export const FOLLOWED_PAGES: { readonly [K in keyof MoodleMethods]?: PageOf<K> } = {
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
};

/**
 * The methods that work through AJAX services alone with no page that shows their work: what they
 * read or change has no page of its own (the site's name, the person's abilities in a course), or
 * its page can't be told from their arguments (an activity's, without its module; a deleted content's bank).
 */
export const UNFOLLOWED_METHODS: readonly (keyof MoodleMethods)[] = ["siteName", "courseAbilities", "courseActivityTypes", "setCompletion", "overrideCompletion", "setQuestionStatus", "deleteContent"];

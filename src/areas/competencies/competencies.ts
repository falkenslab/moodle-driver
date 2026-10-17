// A course's competencies, through the services Moodle's own competency pages call (all AJAX
// services in Moodle 5.2): the frameworks a course can draw from (`core_competency_list_competency_frameworks`,
// `core_competency_list_competencies`), the course's competencies with the activities linked to them
// (`tool_lp_data_for_course_competencies_page`, the course competencies page's), adding and removing
// them (`core_competency_add_competency_to_course`, `…_remove_competency_from_course`), a participant's
// rating and its evidence (`tool_lp_data_for_user_competency_summary_in_course`) and rating them
// (`core_competency_grade_competency_in_course`). Moodle has no service that links a competency to an
// activity: the activity's settings form does it, with its course competencies field.
import type { BrowserContext } from "playwright-core";
import { callService, MoodleServiceError } from "../../core/ajax.js";
import { MoodleError } from "../../core/errors.js";
import { FormError, formValue, openForm, setFields, submitForm } from "../../core/forms.js";

/** Moodle refused to show or change a course's competencies: the capability it takes, or Moodle's reason. */
export class CompetencyError extends MoodleError {
  override name = "CompetencyError";
  constructor(message: string) {
    super(message, "competency");
  }
}

/** The site has competencies turned off (Site administration > Advanced features > Enable competencies): nothing about them works until an administrator turns them on. */
export class CompetenciesDisabledError extends MoodleError {
  override name = "CompetenciesDisabledError";
  constructor(message = "Competencies are disabled on this site: an administrator turns them on in Site administration > Advanced features > Enable competencies.") {
    super(message, "competencies-disabled");
  }
}

/** A competency of a framework, as `competencyFrameworks` lists it. */
export interface Competency {
  id: number;
  shortName: string;
  idNumber: string;
  /** Its description (HTML). */
  description: string;
  /** The competency it's under in the framework, or 0 at the top. */
  parentId: number;
}

/** A competency framework the course can draw its competencies from, with its competencies. */
export interface CompetencyFramework {
  id: number;
  shortName: string;
  idNumber: string;
  /** Its description (HTML). */
  description: string;
  /** Its competencies, in the framework's order (a parent before its children). */
  competencies: Competency[];
}

/** A competency of a course, with the activities linked to it. */
export interface CourseCompetency {
  id: number;
  shortName: string;
  idNumber: string;
  /** Its description (HTML). */
  description: string;
  framework: { id: number; name: string };
  /** The course's activities linked to it (course module ids and names). */
  activities: { id: number; name: string }[];
}

/** A rating on a competency's scale: the scale item's value (1 for its first item) and name. */
export interface CompetencyScaleItem {
  value: number;
  name: string;
  /** Whether this rating means proficient, as the framework (or the competency) sets its scale. */
  proficient: boolean;
}

/** One piece of evidence of a participant's competency: a rating given, or something logged about it. */
export interface CompetencyEvidence {
  id: number;
  /** `override`: a rating given by hand (in a course, a plan or the competency); `complete`: completing it (an activity's or course's rule); `log`: a note without a rating. */
  action: "log" | "complete" | "override";
  /** What happened, as Moodle words it in the site's language. */
  description: string;
  /** The note given with it (plain text), or "". */
  note: string;
  /** The rating it gave, or null. */
  rating: { value: number; name: string } | null;
  /** Who did it, when someone did. */
  by?: { id: number; name: string };
  /** When (ISO). */
  created: string;
}

/** A participant's rating in a course competency, as their competency page in the course shows it. */
export interface CompetencyRating {
  courseId: number;
  userId: number;
  competencyId: number;
  /** Their rating in the course, or null while unrated. */
  rating: { value: number; name: string } | null;
  /** Whether that rating is proficient, or null while unrated. */
  proficient: boolean | null;
  /** The competency's scale: the ratings `rateCompetency` takes. */
  scale: CompetencyScaleItem[];
  /** The evidence in the course, the latest first. */
  evidence: CompetencyEvidence[];
  /** Whether the person may rate them in it. */
  canRate: boolean;
}

/** A rating to give: the scale item's value (1 for the first) or its name, and an optional note kept as evidence. */
export interface CompetencyRatingInput {
  rating: number | string;
  note?: string;
}

const VIEW = "moodle/competency:coursecompetencyview";
const MANAGE = "moodle/competency:coursecompetencymanage";
const GRADE = "moodle/competency:competencygrade";

/** Calls a competency service, with what its failure means: competencies off, a missing capability, or Moodle's reason. */
async function competencyService<T>(context: BrowserContext, siteUrl: string, methodname: string, args: Record<string, unknown>, what: string, capability: string): Promise<T> {
  try {
    return await callService<T>(context, siteUrl, methodname, args);
  } catch (error) {
    if (!(error instanceof MoodleServiceError)) throw error;
    if (error.errorcode === "competenciesarenotenabled") throw new CompetenciesDisabledError();
    const reason = error.message.replace(/^Moodle's \S+ failed \([^)]*\): /, "");
    if (error.errorcode === "nopermissions" || error.errorcode === "requireloginerror") throw new CompetencyError(`${what} (Moodle says: ${reason}): it takes Moodle's capability ${capability}.`);
    throw new CompetencyError(`${what}: ${reason}`);
  }
}

interface RawCompetency {
  id: number;
  shortname: string;
  idnumber: string;
  description: string;
  parentid: number;
}

/**
 * The competency frameworks a course can draw its competencies from (the visible ones of the site
 * and of the course's categories), each with its competencies: their ids are what
 * `addCourseCompetency` takes. Frameworks are made at site or category level; the driver only reads
 * them. Throws `CompetencyError` naming the capability when the person can't view them
 * (moodle/competency:competencyview), `CompetenciesDisabledError` on a site with competencies off.
 */
export async function competencyFrameworks(context: BrowserContext, siteUrl: string, courseId: number): Promise<CompetencyFramework[]> {
  const what = `You can't view the competency frameworks of course ${courseId}`;
  const capability = "moodle/competency:competencyview";
  const frameworks = await competencyService<{ id: number; shortname: string; idnumber: string; description: string }[]>(
    context,
    siteUrl,
    "core_competency_list_competency_frameworks",
    { sort: "shortname", order: "ASC", skip: 0, limit: 0, context: { contextid: 0, contextlevel: "course", instanceid: courseId }, includes: "parents", onlyvisible: true, query: "" },
    what,
    capability,
  );
  return Promise.all(
    frameworks.map(async (f) => {
      const competencies = await competencyService<RawCompetency[]>(context, siteUrl, "core_competency_list_competencies", { filters: [{ column: "competencyframeworkid", value: String(f.id) }], sort: "path", order: "ASC", skip: 0, limit: 0 }, what, capability);
      return { id: f.id, shortName: f.shortname, idNumber: f.idnumber, description: f.description, competencies: competencies.map((c) => ({ id: c.id, shortName: c.shortname, idNumber: c.idnumber, description: c.description, parentId: c.parentid })) };
    }),
  );
}

/** What `tool_lp_data_for_course_competencies_page` answers, as far as the driver reads it. */
export interface CourseCompetenciesPage {
  canmanagecoursecompetencies: boolean;
  competencies: {
    competency: RawCompetency;
    coursemodules: { id: number; name: string }[];
    comppath: { framework: { id: number; name: string } };
  }[];
}

/** The page's data as the driver returns it. */
export function toCourseCompetencies(data: CourseCompetenciesPage): CourseCompetency[] {
  return data.competencies.map(({ competency: c, coursemodules, comppath }) => ({
    id: c.id,
    shortName: c.shortname,
    idNumber: c.idnumber,
    description: c.description,
    framework: { id: comppath.framework.id, name: comppath.framework.name },
    activities: coursemodules.map((cm) => ({ id: cm.id, name: cm.name })),
  }));
}

function coursePage(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseCompetenciesPage> {
  return competencyService<CourseCompetenciesPage>(context, siteUrl, "tool_lp_data_for_course_competencies_page", { courseid: courseId, moduleid: 0 }, `You can't view the competencies of course ${courseId}`, VIEW);
}

/**
 * A course's competencies, as its competencies page lists them: each one's short name, id number,
 * description, framework and the course's activities linked to it. Anyone in the course with
 * moodle/competency:coursecompetencyview (students and teachers by default) reads them. Throws
 * `CompetencyError` naming the capability when the person can't, `CompetenciesDisabledError` on a
 * site with competencies off.
 */
export async function courseCompetencies(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseCompetency[]> {
  return toCourseCompetencies(await coursePage(context, siteUrl, courseId));
}

/** What adding or removing a course competency did, and the course's competencies afterwards. */
export interface CourseCompetencyChange {
  changed: string;
  courseId: number;
  competencyId: number;
  competencies: CourseCompetency[];
}

/**
 * Adds a framework's competency to a course (nothing when it's there already), as the course
 * competencies page's "Add competencies to course" does; the competency ids come from
 * `competencyFrameworks`. Returns the course's competencies afterwards. Throws `CompetencyError`
 * naming the capability when the person can't (moodle/competency:coursecompetencymanage, which
 * editing teachers have) or with Moodle's reason (no such competency), `CompetenciesDisabledError` on
 * a site with competencies off.
 */
export async function addCourseCompetency(context: BrowserContext, siteUrl: string, courseId: number, competencyId: number): Promise<CourseCompetencyChange> {
  const added = await competencyService<boolean>(context, siteUrl, "core_competency_add_competency_to_course", { courseid: courseId, competencyid: competencyId }, `You can't add competency ${competencyId} to course ${courseId}`, MANAGE);
  const competencies = await courseCompetencies(context, siteUrl, courseId);
  return { changed: added ? `Added competency ${competencyId} to course ${courseId}.` : `Competency ${competencyId} was already in course ${courseId}.`, courseId, competencyId, competencies };
}

/**
 * Removes a competency from a course (nothing when it isn't there); Moodle unlinks it from the
 * course's activities too, and keeps the ratings already given. Returns the course's competencies
 * afterwards. Throws `CompetencyError` naming the capability when the person can't
 * (moodle/competency:coursecompetencymanage), `CompetenciesDisabledError` on a site with competencies off.
 */
export async function removeCourseCompetency(context: BrowserContext, siteUrl: string, courseId: number, competencyId: number): Promise<CourseCompetencyChange> {
  const removed = await competencyService<boolean>(context, siteUrl, "core_competency_remove_competency_from_course", { courseid: courseId, competencyid: competencyId }, `You can't remove competency ${competencyId} from course ${courseId}`, MANAGE);
  const competencies = await courseCompetencies(context, siteUrl, courseId);
  return { changed: removed ? `Removed competency ${competencyId} from course ${courseId}.` : `Competency ${competencyId} wasn't in course ${courseId}.`, courseId, competencyId, competencies };
}

/** What `setActivityCompetencies` did, and the activity's competencies afterwards. */
export interface ActivityCompetencyChange {
  changed: string;
  activityId: number;
  /** The ids of the competencies linked to the activity afterwards. */
  competencyIds: number[];
}

/**
 * Sets which of its course's competencies an activity is linked to (all of them at once: the ones
 * not given are unlinked, `[]` unlinks them all), through the activity's settings form, its
 * "Course competencies" field: Moodle has no service for it. Only competencies of the course can be
 * linked (`addCourseCompetency` first). Returns the activity's competencies afterwards. Throws
 * `CompetencyError` naming the capability when the person can't (moodle/competency:coursecompetencymanage)
 * or for a competency that isn't the course's, `CompetenciesDisabledError` on a site with competencies off.
 */
export async function setActivityCompetencies(context: BrowserContext, siteUrl: string, activityId: number, competencyIds: number[]): Promise<ActivityCompetencyChange> {
  if (!Array.isArray(competencyIds) || competencyIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new MoodleError("Give the competencies as a list of their ids ([] for none).", "invalid-input");
  const wanted = [...new Set(competencyIds)];
  const what = `You can't set the competencies of activity ${activityId}`;
  let page;
  try {
    page = await openForm(context, siteUrl, `course/modedit.php?update=${activityId}&return=0`);
  } catch (error) {
    // Moodle shows an error page instead of the form: no such activity, or no right to edit it.
    if (error instanceof FormError) throw new CompetencyError(`${what}: Moodle didn't show its settings form (is there such an activity? Editing it takes moodle/course:manageactivities, and its competencies ${MANAGE}).`);
    throw error;
  }
  let courseId: number;
  try {
    courseId = Number(await formValue(page, "course"));
    const options = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { options: ArrayLike<{ value: string }> } | null } }).document;
      const select = doc.querySelector('form.mform select[name="competencies[]"]');
      return select ? Array.from(select.options).map((option) => Number(option.value)) : null;
    });
    if (options === null) {
      // The form leaves the field out with competencies off, or without the capability: the course's page says which.
      const data = await coursePage(context, siteUrl, courseId);
      if (!data.canmanagecoursecompetencies) throw new CompetencyError(`${what}: it takes Moodle's capability ${MANAGE}.`);
      throw new CompetencyError(`${what}: its settings form has no competencies field.`);
    }
    const foreign = wanted.filter((id) => !options.includes(id));
    if (foreign.length > 0) throw new CompetencyError(`${what}: competency ${foreign.join(", ")} isn't one of course ${courseId}'s competencies (add it with addCourseCompetency first).`);
    try {
      await setFields(page, { "competencies[]": wanted.map(String) });
      await submitForm(page, "submitbutton2");
    } catch (error) {
      if (error instanceof FormError) throw new CompetencyError(`${what}: Moodle refused the form: ${error.fields.map((f) => `${f.field}: ${f.message}`).join("; ")}.`);
      throw error;
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  const linked = (await courseCompetencies(context, siteUrl, courseId)).filter((c) => c.activities.some((a) => a.id === activityId)).map((c) => c.id);
  return { changed: `Activity ${activityId} linked to ${linked.length === 0 ? "no competencies" : `competencies ${linked.join(", ")}`}.`, activityId, competencyIds: linked };
}

/** What `tool_lp_data_for_user_competency_summary_in_course` answers, as far as the driver reads it. */
export interface UserCompetencySummary {
  usercompetencysummary: {
    cangrade: boolean;
    competency: { scaleid: number; scaleconfiguration: string };
    usercompetencycourse?: { grade: number | null; gradename: string; proficiency: boolean | number | null };
    evidence: {
      id: number;
      action: number;
      description: string;
      note: string | null;
      grade: number | null;
      gradename: string;
      actionuserid: number | null;
      actionuser?: { id: number; fullname: string };
      timecreated: number;
    }[];
  };
}

const ACTIONS: Record<number, CompetencyEvidence["action"]> = { 0: "log", 2: "complete", 3: "override" };

/** The summary as the driver returns it, with the scale's names from `core_competency_get_scale_values`. */
export function toCompetencyRating(courseId: number, userId: number, competencyId: number, data: UserCompetencySummary, scaleNames: { id: number; name: string }[]): CompetencyRating {
  const summary = data.usercompetencysummary;
  // The scale's configuration: its id first, then each item with whether it's proficient.
  let configuration: { id?: number; proficient?: number | boolean }[] = [];
  try {
    configuration = JSON.parse(summary.competency.scaleconfiguration || "[]") as typeof configuration;
  } catch {
    configuration = [];
  }
  const scale = scaleNames.map(({ id, name }) => ({ value: id, name, proficient: Boolean(configuration.find((item) => item.id === id)?.proficient) }));
  const nameOf = (value: number, fallback: string) => scale.find((item) => item.value === value)?.name ?? fallback;
  const ucc = summary.usercompetencycourse;
  const grade = ucc?.grade ?? null;
  return {
    courseId,
    userId,
    competencyId,
    rating: grade === null ? null : { value: grade, name: nameOf(grade, ucc!.gradename) },
    proficient: grade === null || ucc?.proficiency === null || ucc?.proficiency === undefined ? null : Boolean(ucc.proficiency),
    scale,
    evidence: summary.evidence.map((e) => ({
      id: e.id,
      action: ACTIONS[e.action] ?? "log",
      description: e.description,
      note: e.note ?? "",
      rating: e.grade === null || e.grade === undefined ? null : { value: e.grade, name: nameOf(e.grade, e.gradename) },
      ...(e.actionuser ? { by: { id: e.actionuser.id, name: e.actionuser.fullname } } : {}),
      created: new Date(e.timecreated * 1000).toISOString(),
    })),
    canRate: summary.cangrade,
  };
}

/**
 * A participant's rating in one of the course's competencies, as their competency page in the
 * course shows it: the rating (null while unrated) and whether it's proficient, the competency's
 * scale, and the evidence in the course (each rating given, with its note, who and when). A teacher
 * reads anyone's in the course (moodle/competency:usercompetencyview), a student their own. Throws
 * `CompetencyError` naming the capability when the person can't, or with Moodle's reason (a
 * competency that isn't the course's), `CompetenciesDisabledError` on a site with competencies off.
 */
export async function competencyRating(context: BrowserContext, siteUrl: string, courseId: number, userId: number, competencyId: number): Promise<CompetencyRating> {
  const what = `You can't view user ${userId}'s rating in competency ${competencyId} of course ${courseId}`;
  const capability = "moodle/competency:usercompetencyview";
  const data = await competencyService<UserCompetencySummary>(context, siteUrl, "tool_lp_data_for_user_competency_summary_in_course", { userid: userId, competencyid: competencyId, courseid: courseId }, what, capability);
  const names = await competencyService<{ id: number; name: string }[]>(context, siteUrl, "core_competency_get_scale_values", { scaleid: data.usercompetencysummary.competency.scaleid }, what, capability);
  return toCompetencyRating(courseId, userId, competencyId, data, names);
}

/** What `rateCompetency` did, and the participant's rating afterwards. */
export interface CompetencyRatingChange {
  changed: string;
  rating: CompetencyRating;
}

/**
 * Rates a participant in one of the course's competencies, as the rating dialog of their competency
 * page in the course does: `rating` is a scale item's value (1 for the first) or its name, and the
 * `note`, when given, is kept with the rating as its evidence. The new rating replaces the course's
 * rating; Moodle may also push it to the participant's learning plans (the course's setting). Returns
 * the rating afterwards. Throws a `MoodleError` with code `invalid-input` for a rating not on the
 * scale, `CompetencyError` naming the capability when the person can't (moodle/competency:competencygrade,
 * which editing teachers have) or with Moodle's reason (a participant who can't be rated in the
 * course), `CompetenciesDisabledError` on a site with competencies off.
 */
export async function rateCompetency(context: BrowserContext, siteUrl: string, courseId: number, userId: number, competencyId: number, input: CompetencyRatingInput): Promise<CompetencyRatingChange> {
  const given = input?.rating;
  if (typeof given !== "number" && typeof given !== "string") throw new MoodleError("Give the rating: a scale item's value (1 for the first) or its name.", "invalid-input");
  const before = await competencyRating(context, siteUrl, courseId, userId, competencyId);
  const item = before.scale.find((s) => (typeof given === "number" ? s.value === given : s.name.trim().toLowerCase() === given.trim().toLowerCase()));
  if (!item) throw new MoodleError(`"${String(given)}" isn't on competency ${competencyId}'s scale: ${before.scale.map((s) => `${s.value} (${s.name})`).join(", ")}.`, "invalid-input");
  const note = input.note?.trim();
  await competencyService(context, siteUrl, "core_competency_grade_competency_in_course", { courseid: courseId, userid: userId, competencyid: competencyId, grade: item.value, ...(note ? { note } : {}) }, `You can't rate user ${userId} in competency ${competencyId} of course ${courseId}`, GRADE);
  const rating = await competencyRating(context, siteUrl, courseId, userId, competencyId);
  return { changed: `Rated user ${userId} "${item.name}" in competency ${competencyId} of course ${courseId}${note ? ", with a note" : ""}.`, rating };
}

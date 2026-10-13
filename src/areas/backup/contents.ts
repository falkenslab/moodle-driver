// What a backup file holds and what its pieces refer to outside it, read locally from its XML files
// (no browser, no session): for keeping backups in a catalog and restoring them without surprises.
import path from "node:path";
import { checkLocalFiles } from "../../core/files.js";
import { BackupError } from "./errors.js";
import { addSectionDetails, childrenOf, parseBackupInfo, parseXml, readTarEntries, textOf, type BackupInfo, type XmlElement } from "./mbz.js";

/**
 * Something an activity of a backup refers to that the backup doesn't hold, so a restore elsewhere
 * leaves it broken or changed:
 * - `restriction`: an access condition on another activity's completion (`activityId`), on a grade
 *   item (`gradeItemId`, another activity's grade or the course's), on a group or a grouping (never in
 *   a backup of part of a course): Moodle restores it marked as broken.
 * - `link`: a link in its text to another activity (`activityId`, its `module`): restored elsewhere,
 *   it points to whatever has that id on the site, or nothing.
 * - `grade-category`: the gradebook category its grade sat in (`categoryId`), when the backup has no
 *   gradebook (any part of a course): restored, its grade goes into the course's top category. The
 *   original may have been the top category too: the backup doesn't say.
 */
export interface BackupDependency {
  kind: "restriction" | "link" | "grade-category";
  /** For a restriction: what it's on. */
  condition?: "completion" | "grade" | "group" | "grouping";
  activityId?: number;
  module?: string;
  gradeItemId?: number;
  groupId?: number;
  groupingId?: number;
  categoryId?: number;
}

/** A section a backup holds (the original site's ids). */
export interface BackupContentsSection {
  id: number;
  /** Its number in the original course: a restore merged into a course puts it into the section with that number. */
  number?: number;
  /** The name given to it; none means the course format's default ("New section", "Topic 2"). */
  name?: string;
  /** Its description (HTML, with Moodle's backup placeholders for files and links). */
  summary?: string;
  visible?: boolean;
  /** For a subsection (Moodle 5), the subsection activity that holds it. */
  parentActivityId?: number;
}

/** An activity or resource a backup holds (the original site's ids). */
export interface BackupContentsActivity {
  /** Its course module id on the original site. */
  id: number;
  /** Its module: "page", "quiz", "resource"… */
  type: string;
  title: string;
  /** Its section's id on the original site. */
  sectionId: number;
  /** What it refers to that the backup doesn't hold: none when it's self-contained. */
  dependencies: BackupDependency[];
}

/** What a backup file holds, as `backupContents` reads it. */
export interface BackupContents {
  /** The file's name. */
  name: string;
  /** A backup of a course (whole, or the part chosen), of one section or of one activity. */
  type: "course" | "section" | "activity";
  /** The Moodle that made it: its version number ("2026042004") and release ("5.2.4 (Build: 20261005)"). */
  moodle: { version: string; release: string };
  /** Where it was made: the site's address and the course. */
  original: { site?: string; courseId: number; courseFullName?: string; courseShortName?: string; format?: string };
  sections: BackupContentsSection[];
  activities: BackupContentsActivity[];
  /**
   * The plugins a site needs to restore all of it, by their full names: activity modules
   * (`mod_quiz`), question types (`qtype_multichoice`), blocks (`block_html`) and the course format
   * (`format_topics`, used for a new course).
   */
  plugins: string[];
  /** Whether it holds people's data (users, and with them their work, grades, posts…). */
  withUsers: boolean;
  /** Whether it holds the course's gradebook setup (its categories): a whole course's with graded activities does, a part's doesn't. */
  gradebook: boolean;
}

/** An activity's own XML files, where its text is (not its references, roles, grades or logs). */
const TEXT_FILE = /^activities\/[^/]+\/(?!inforef|roles|grades|grade_history|grading|calendar|comments|completion|logs|logstores|filters|competencies|xapistate)[^/]+\.xml$/;
/** Moodle's placeholder for a link to an activity in a backup's text: `$@PAGEVIEWBYID*12@$`. */
const LINK = /\$@([A-Z]+)VIEWBYID\*(\d+)@\$/g;

/** The leaves of Moodle's availability tree (its JSON). */
export function conditionsOf(json: string | undefined): Record<string, unknown>[] {
  if (!json) return [];
  let tree: unknown;
  try {
    tree = JSON.parse(json);
  } catch {
    return [];
  }
  const leaves: Record<string, unknown>[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const { c } = node as { c?: unknown[] };
    if (Array.isArray(c)) c.forEach(walk);
    else leaves.push(node as Record<string, unknown>);
  };
  walk(tree);
  return leaves;
}

/** What one condition of an activity's restrictions refers to outside the backup, if anything. */
function restrictionDependency(condition: Record<string, unknown>, held: { activities: Set<number>; gradeItems: Set<number>; groups: Set<number>; groupings: Set<number> }): BackupDependency | undefined {
  const id = Number(condition.type === "completion" ? condition.cm : condition.id);
  // Moodle's "the previous activity" (-1) is the one before it wherever it's restored.
  if (!Number.isFinite(id) || id <= 0) return undefined;
  switch (condition.type) {
    case "completion":
      return held.activities.has(id) ? undefined : { kind: "restriction", condition: "completion", activityId: id };
    case "grade":
      return held.gradeItems.has(id) ? undefined : { kind: "restriction", condition: "grade", gradeItemId: id };
    case "group":
      return held.groups.has(id) ? undefined : { kind: "restriction", condition: "group", groupId: id };
    case "grouping":
      return held.groupings.has(id) ? undefined : { kind: "restriction", condition: "grouping", groupingId: id };
    default:
      return undefined;
  }
}

/** The ids of the elements named `name` anywhere under `element`, by their `id` attribute. */
function idsOf(element: XmlElement | undefined, name: string): number[] {
  if (!element) return [];
  const ids: number[] = [];
  const walk = (at: XmlElement) => {
    if (at.name === name && at.attributes.id) ids.push(Number(at.attributes.id));
    at.children.forEach(walk);
  };
  walk(element);
  return ids;
}

const parsed = (entries: Map<string, Buffer>, name: string): XmlElement | undefined => {
  const xml = entries.get(name);
  if (!xml) return undefined;
  try {
    return parseXml(xml.toString("utf8"));
  } catch {
    return undefined;
  }
};

/** The contents of a backup from its entries (`moodle_backup.xml`, the sections', activities' and questions' XML) and the names of all its files. */
export function contentsOf(file: string, info: BackupInfo, entries: Map<string, Buffer>, names: string[]): BackupContents {
  const activities = info.activities.filter((a) => a.included);
  const held = {
    activities: new Set(activities.map((a) => a.id)),
    gradeItems: new Set(activities.flatMap((a) => idsOf(parsed(entries, `${a.directory}/grades.xml`), "grade_item"))),
    groups: new Set(idsOf(parsed(entries, "groups.xml"), "group")),
    groupings: new Set(idsOf(parsed(entries, "groups.xml"), "grouping")),
  };
  // A backup of part of a course has a gradebook.xml too, empty: the course's gradebook is in it when it has categories.
  const gradebookXml = parsed(entries, "gradebook.xml");
  const gradebook = idsOf(gradebookXml, "grade_category").length > 0;
  for (const id of idsOf(gradebookXml, "grade_item")) held.gradeItems.add(id);
  const contents: BackupContentsActivity[] = activities.map((activity) => {
    const dependencies: BackupDependency[] = [];
    const add = (dependency: BackupDependency) => {
      if (!dependencies.some((d) => JSON.stringify(d) === JSON.stringify(dependency))) dependencies.push(dependency);
    };
    const module = parsed(entries, `${activity.directory}/module.xml`);
    for (const condition of conditionsOf(textOf(module, "availability"))) {
      const dependency = restrictionDependency(condition, held);
      if (dependency) add(dependency);
    }
    for (const [name, xml] of entries) {
      if (!name.startsWith(`${activity.directory}/`) || !TEXT_FILE.test(name)) continue;
      for (const [, module, id] of xml.toString("utf8").matchAll(LINK)) {
        // Links to the course's own pages (COURSEVIEWBYID) follow the course wherever it's restored.
        if (module === "COURSE" || held.activities.has(Number(id))) continue;
        add({ kind: "link", activityId: Number(id), module: module!.toLowerCase() });
      }
    }
    if (!gradebook) {
      for (const item of childrenOf(parsed(entries, `${activity.directory}/grades.xml`), "grade_items", "grade_item")) {
        const category = Number(textOf(item, "categoryid"));
        if (category && textOf(item, "itemtype") === "mod") add({ kind: "grade-category", categoryId: category });
      }
    }
    return { id: activity.id, type: activity.module, title: activity.title, sectionId: activity.sectionId, dependencies };
  });
  const questionTypes = new Set<string>();
  const walk = (at: XmlElement) => {
    if (at.name === "qtype" && at.text.trim()) questionTypes.add(at.text.trim());
    at.children.forEach(walk);
  };
  for (const [name] of entries) if (name === "questions.xml" || /^activities\/[^/]+\/questions\.xml$/.test(name)) {
    const questions = parsed(entries, name);
    if (questions) walk(questions);
  }
  const blocks = new Set(names.map((name) => /(?:^|\/)blocks\/([a-z0-9_]+?)_\d+\/block\.xml$/.exec(name)?.[1]).filter((name): name is string => Boolean(name)));
  const plugins = [
    ...[...new Set(activities.map((a) => a.module))].map((m) => `mod_${m}`),
    ...[...questionTypes].map((q) => `qtype_${q}`),
    ...[...blocks].map((b) => `block_${b}`),
    ...(info.originalCourse.format ? [`format_${info.originalCourse.format}`] : []),
  ];
  return {
    name: path.basename(file),
    type: info.type,
    moodle: { version: info.moodleVersion, release: info.moodleRelease },
    original: {
      ...(info.originalSite ? { site: info.originalSite } : {}),
      courseId: info.originalCourse.id,
      ...(info.originalCourse.fullName ? { courseFullName: info.originalCourse.fullName } : {}),
      ...(info.originalCourse.shortName ? { courseShortName: info.originalCourse.shortName } : {}),
      ...(info.originalCourse.format ? { format: info.originalCourse.format } : {}),
    },
    sections: info.sections
      .filter((s) => s.included)
      .map((s) => ({
        id: s.id,
        ...(s.number !== undefined ? { number: s.number } : {}),
        ...(s.name ? { name: s.name } : {}),
        ...(s.summary ? { summary: s.summary } : {}),
        ...(s.visible !== undefined ? { visible: s.visible } : {}),
        ...(s.parentActivityId ? { parentActivityId: s.parentActivityId } : {}),
      })),
    activities: contents,
    plugins,
    withUsers: info.settings.users === "1",
    gradebook,
  };
}

/** The entries `contentsOf` reads: the backup's description and the sections', activities', questions' and groups' XML. */
const WANTED = /^(moodle_backup\.xml|questions\.xml|groups\.xml|gradebook\.xml|sections\/[^/]+\/section\.xml|activities\/[^/]+\/[^/]+\.xml)$/;

/** Reads a backup file's contents (see `backupContents`), its names listed as it goes. */
export async function readBackupContents(file: string): Promise<{ info: BackupInfo; contents: BackupContents }> {
  await checkLocalFiles([file]);
  const names: string[] = [];
  const entries = await readTarEntries(file, (name) => {
    names.push(name);
    return WANTED.test(name);
  });
  const xml = entries.get("moodle_backup.xml");
  if (!xml) throw new BackupError(`${file} isn't a Moodle backup: it has no moodle_backup.xml.`);
  const info = parseBackupInfo(xml.toString("utf8"), file);
  addSectionDetails(info, entries);
  return { info, contents: contentsOf(file, info, entries, names) };
}

/**
 * What a backup file (`.mbz`) holds, read on this computer without restoring it, without a browser
 * or a session: the Moodle that made it, the original site and course, its sections and activities
 * (the original site's ids), the plugins a site needs to restore it, whether it holds people's data,
 * and, per activity, what it refers to that the backup doesn't hold (restrictions on activities left
 * out, links to them in its text, its grade category), which a restore elsewhere leaves broken.
 * `BackupError` when the file isn't a Moodle backup (or is a zip-format one, which isn't read).
 */
export async function backupContents(file: string): Promise<BackupContents> {
  return (await readBackupContents(file)).contents;
}

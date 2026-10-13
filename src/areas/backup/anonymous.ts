// Anonymous backups: what a backup says about the people who made its content and the site and course
// it came from, found and cleared in its XML, locally (no browser, no session), so the file can be
// shared with teachers of other sites. Its content (texts, settings, files) stays as it was.
import { stat } from "node:fs/promises";
import path from "node:path";
import { checkLocalFiles } from "../../core/files.js";
import { MoodleError } from "../../core/errors.js";
import { BackupError } from "./errors.js";
import { parseBackupInfo, readTarEntries, rewriteTar, type BackupInfo } from "./mbz.js";

/**
 * What an anonymous backup says instead. The site is one that can't exist (`.invalid`, RFC 2606) and
 * its identifier hash no site's, so Moodle restores it anywhere as a backup from another site: links
 * it can't point at a restored activity point there, and questions and files go to who restores them.
 */
export const ANONYMOUS = {
  site: "https://anonymous.invalid",
  siteHash: "00000000000000000000000000000000",
  courseId: 0,
  courseFullName: "Restored course",
  courseShortName: "restored",
  fileName: "backup.mbz",
  stampHost: "anonymous",
} as const;

/** Something in a backup that names a person, or the site or course it came from. */
export interface BackupIdentifier {
  /** The backup's file it's in: "moodle_backup.xml", "files.xml", "questions.xml"… */
  file: string;
  /** The field: an element's name ("userid", "author", "original_wwwroot", "stamp"…), or "text" for the site's address inside a text. */
  field: string;
  value: string;
}

/** Where a backup came from, as its moodle_backup.xml says: what to look for in the rest. */
interface Origin {
  site?: string;
  courseId: number;
  courseFullName?: string;
  courseShortName?: string;
}

const originOf = (info: BackupInfo): Origin => ({
  site: info.originalSite && info.originalSite !== ANONYMOUS.site ? info.originalSite.replace(/\/+$/, "") : undefined,
  courseId: info.originalCourse.id,
  courseFullName: info.originalCourse.fullName,
  courseShortName: info.originalCourse.shortName,
});

/**
 * Elements holding a user's id, as Moodle's backup writes them (the fields it annotates as users,
 * and the questions' and files' owners): set to 0, no user, which a restore on another site gives to
 * who restores it (questions' creators and owners, files' owners: `restore_dbops`, confirmed on 5.2).
 */
const PERSON_IDS = ["userid", "usermodified", "usercreated", "createdby", "modifiedby", "ownerid", "authorid", "uploaderid", "reviewerid", "raterid", "issuerid", "loggeduser", "recipientid"];
/** Elements holding a person's name or address: a file's author (Moodle null), a badge's issuer (empty). */
const PERSON_TEXTS: Record<string, string> = { author: "$@NULL@$", issuername: "", issuercontact: "", issueremail: "", issuerurl: "" };
/**
 * Moodle's placeholders for links whose id is the course's (`COURSEVIEWBYID`, the modules' index
 * pages `<MODULE>INDEX`…): given the anonymous course id with it, so a restore still maps them to
 * the course restored into.
 */
const COURSE_LINK = /^(COURSEVIEWBYID|BADGESVIEWBYID|USERINDEXVIEWBYID|[A-Z0-9]+INDEX(?:BYID|URLENCODED)?)$/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Text as XML escapes it in an element (what Moodle's XML writer does). */
const xmlText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const isNull = (value: string) => value === "" || value === "$@NULL@$";

/**
 * One of a backup's files with what identifies cleared: the rewritten text, and what was found. The
 * same rules find and clear, so a backup they've been through has nothing left for them to find.
 */
export function scrub(file: string, text: string, origin: Origin): { text: string; found: BackupIdentifier[] } {
  const found: BackupIdentifier[] = [];
  const note = (field: string, value: string) => {
    if (!found.some((f) => f.field === field && f.value === value)) found.push({ file, field, value });
  };
  if (file === "moodle_backup.log") {
    if (text.trim()) note("log", "the backup's log");
    return { text: "", found };
  }
  if (file === ".ARCHIVE_INDEX" || !file.endsWith(".xml")) return { text, found };
  let xml = text;
  const element = (name: string, replace: (value: string) => string | undefined, scope?: RegExp) => {
    const pattern = scope ?? new RegExp(`(<${name}>)([^<]*)(</${name}>)`, "g");
    xml = xml.replace(pattern, (whole, open: string, value: string, close: string) => {
      const next = replace(value);
      if (next === undefined || next === value) return whole;
      note(name, value);
      return `${open}${next}${close}`;
    });
  };
  for (const name of PERSON_IDS) element(name, (value) => (/^\s*\d+\s*$/.test(value) && Number(value) !== 0 ? "0" : undefined));
  for (const [name, empty] of Object.entries(PERSON_TEXTS)) element(name, (value) => (isNull(value.trim()) ? undefined : empty));
  // Question categories' and questions' stamps (and older questions' versions) start with the site's host name.
  for (const name of ["stamp", "version"]) {
    element(name, (value) => {
      const match = /^([^+]+)(\+\d{12}\+.*)$/.exec(value);
      return match && match[1] !== ANONYMOUS.stampHost ? `${ANONYMOUS.stampHost}${match[2]}` : undefined;
    });
  }
  if (file === "moodle_backup.xml") {
    element("original_wwwroot", (value) => (value.trim() !== ANONYMOUS.site ? ANONYMOUS.site : undefined));
    element("original_site_identifier_hash", (value) => (value.trim() !== ANONYMOUS.siteHash ? ANONYMOUS.siteHash : undefined));
    element("original_course_id", (value) => (Number(value) !== ANONYMOUS.courseId ? String(ANONYMOUS.courseId) : undefined));
    element("original_course_fullname", (value) => (value !== ANONYMOUS.courseFullName ? xmlText(ANONYMOUS.courseFullName) : undefined));
    element("original_course_shortname", (value) => (value !== ANONYMOUS.courseShortName ? xmlText(ANONYMOUS.courseShortName) : undefined));
    // The backup's file name (Moodle's has the course's id and short name), and the setting that repeats it.
    element("name", (value) => (value !== ANONYMOUS.fileName ? ANONYMOUS.fileName : undefined), /(<information>\s*<name>)([^<]*)(<\/name>)/);
    element("filename", (value) => (value !== ANONYMOUS.fileName ? ANONYMOUS.fileName : undefined), /(<name>filename<\/name>\s*<value>)([^<]*)(<\/value>)/g);
    element("courseid", (value) => (Number(value) !== ANONYMOUS.courseId ? String(ANONYMOUS.courseId) : undefined), /(<course>\s*<courseid>)([^<]*)(<\/courseid>)/);
    element("title", (value) => (value !== ANONYMOUS.courseShortName ? xmlText(ANONYMOUS.courseShortName) : undefined), /(<course>\s*<courseid>[^<]*<\/courseid>\s*<title>)([^<]*)(<\/title>)/);
  }
  if (file === "course/course.xml") {
    element("id", (value) => (Number(value) !== ANONYMOUS.courseId ? String(ANONYMOUS.courseId) : undefined), /(<course id=")(\d+)(")/);
    element("shortname", (value) => (value !== ANONYMOUS.courseShortName ? xmlText(ANONYMOUS.courseShortName) : undefined));
    element("fullname", (value) => (value !== ANONYMOUS.courseFullName ? xmlText(ANONYMOUS.courseFullName) : undefined));
    element("idnumber", (value) => (value.trim() ? "" : undefined));
    // The site's category the course was in: Moodle restores into the category it's told.
    element("category", (value) => (value.trim() ? "" : undefined), /(<category id="\d+">\s*<name>)([^<]*)(<\/name>)/);
  }
  if (file === "questions.xml" || /^activities\/[^/]+\/questions\.xml$/.test(file)) {
    // Moodle names the default categories after their context: the course, in older backups.
    const names = [origin.courseFullName, origin.courseShortName].filter((name): name is string => Boolean(name && name.trim().length > 2));
    for (const tag of ["name", "info"]) {
      element(tag, (value) => {
        let next = value;
        for (const name of names) next = next.replaceAll(xmlText(name), tag === "name" || name === origin.courseFullName ? xmlText(ANONYMOUS.courseFullName) : xmlText(ANONYMOUS.courseShortName));
        return next;
      }, new RegExp(`(<question_category id="\\d+">[\\s\\S]*?<${tag}>)([^<]*)(</${tag}>)`, "g"));
    }
  }
  if (origin.courseId !== ANONYMOUS.courseId) {
    xml = xml.replace(new RegExp(`\\$@([A-Z0-9]+)\\*${origin.courseId}@\\$`, "g"), (whole, rule: string) => (COURSE_LINK.test(rule) ? `$@${rule}*${ANONYMOUS.courseId}@$` : whole));
  }
  // The site's address left in a text (a link Moodle doesn't encode), also as JSON writes it.
  if (origin.site) {
    const host = origin.site.replace(/^https?:\/\//, "");
    const address = new RegExp(`https?:(\\\\?/){2}${escapeRegExp(host).replaceAll("/", "\\\\?/")}(?![\\w.-])`, "g");
    xml = xml.replace(address, (whole) => {
      note("text", whole.replaceAll("\\/", "/"));
      return whole.includes("\\/") ? ANONYMOUS.site.replaceAll("/", "\\/") : ANONYMOUS.site;
    });
  }
  return { text: xml, found };
}

/** The entries anonymizing reads and may rewrite: every XML file, the backup's log and its index. */
export const SCRUBBED = (name: string) => name.endsWith(".xml") || name === "moodle_backup.log" || name === ".ARCHIVE_INDEX";

/** What in a backup's entries names a person, or the site or course it came from. */
export function identifiersOf(info: BackupInfo, entries: Map<string, Buffer>): BackupIdentifier[] {
  const origin = originOf(info);
  return [...entries].filter(([name]) => SCRUBBED(name)).flatMap(([name, data]) => scrub(name, data.toString("utf8"), origin).found);
}

/** The archive's index (`.ARCHIVE_INDEX`, Moodle's list of its files with their sizes) with the sizes of the files rewritten. */
function reindexed(index: string, replaced: Map<string, Buffer>): string {
  return index
    .split("\n")
    .map((line) => {
      const fields = line.split("\t");
      const data = fields.length === 4 && fields[1] === "f" ? replaced.get(fields[0]!) : undefined;
      return data ? [fields[0], fields[1], String(data.length), fields[3]].join("\t") : line;
    })
    .join("\n");
}

/** Reads a backup's entries for anonymizing: its description parsed, its XML, log and index. */
async function readScrubbed(file: string): Promise<{ info: BackupInfo; entries: Map<string, Buffer> }> {
  await checkLocalFiles([file]);
  const entries = await readTarEntries(file, SCRUBBED);
  const xml = entries.get("moodle_backup.xml");
  if (!xml) throw new BackupError(`${file} isn't a Moodle backup: it has no moodle_backup.xml.`);
  return { info: parseBackupInfo(xml.toString("utf8"), file), entries };
}

/**
 * Writes to `destFile` a copy of a backup file (`.mbz`) that names no one and no site: no browser,
 * no session. Every user id in its XML is 0 (files' owners, questions' creators, modifiers and
 * owners…), every author's or issuer's name empty; the original site's address and identifier hash,
 * the course's id and names, the file's name, the site's host in question stamps, the site's address
 * in texts and the backup's log are replaced by neutral values (`ANONYMOUS`). The content (texts,
 * settings, files) stays as it was; the numeric ids of the backup's pieces too, which only matter
 * inside it. Moodle restores the copy as a backup from another site, wherever it's restored: the
 * questions and files are the restoring person's, and links to activities left out of the backup
 * point to the neutral site. Returns what was cleared. `destFile` may be `file` itself. A backup with
 * users' data is refused: Moodle's own anonymization makes those (its `anonymize` setting).
 */
export async function anonymizeBackup(file: string, destFile: string): Promise<{ changed: string; file: { path: string; name: string; size: number }; cleared: BackupIdentifier[] }> {
  if (!path.isAbsolute(destFile)) throw new MoodleError(`Give files as absolute paths: "${destFile}".`, "invalid-input");
  const { info, entries } = await readScrubbed(file);
  if (info.settings.users === "1") {
    throw new BackupError(`${file} holds people's data (users): back the course up without users' data, or with Moodle's own anonymization (backupCourse's withUsers and anonymize).`);
  }
  const origin = originOf(info);
  const replaced = new Map<string, Buffer>();
  const cleared: BackupIdentifier[] = [];
  for (const [name, data] of entries) {
    const { text, found } = scrub(name, data.toString("utf8"), origin);
    cleared.push(...found);
    if (found.length > 0 || text !== data.toString("utf8")) replaced.set(name, Buffer.from(text, "utf8"));
  }
  const index = entries.get(".ARCHIVE_INDEX");
  if (index && replaced.size > 0) replaced.set(".ARCHIVE_INDEX", Buffer.from(reindexed(index.toString("utf8"), replaced), "utf8"));
  await rewriteTar(file, destFile, replaced);
  // Read back: nothing the rules find may be left.
  const check = await readScrubbed(destFile);
  const left = identifiersOf(check.info, check.entries);
  if (left.length > 0) throw new BackupError(`${destFile} still names ${left.map((l) => `${l.file} ${l.field}`).join(", ")} after anonymizing it.`);
  const size = (await stat(destFile)).size;
  const name = path.basename(destFile);
  const what = cleared.length === 0 ? "it named no one and no site already" : `${cleared.length} thing(s) that named a person, the site or the course cleared`;
  return { changed: `Backup ${path.basename(file)} written anonymous to ${name}: ${what}.`, file: { path: destFile, name, size }, cleared };
}

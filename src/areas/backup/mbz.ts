// A Moodle backup file (.mbz) read locally, with Node alone: no browser, no session. An .mbz is a
// gzipped tar (Moodle's default; a site set to `usezipbackups` writes a zip, which isn't read here)
// holding `moodle_backup.xml`, the backup's description, and an XML file per part of it.
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { checkLocalFiles } from "../../core/files.js";
import { BackupError } from "./errors.js";

/**
 * The entries of a gzipped tar whose names `wanted` accepts, read as a stream: the rest is skipped
 * without being kept, so a backup of any size takes little memory. Stops early once `enough` says so.
 */
export async function readTarEntries(file: string, wanted: (name: string) => boolean, enough?: (found: Map<string, Buffer>) => boolean): Promise<Map<string, Buffer>> {
  const found = new Map<string, Buffer>();
  const kind = await archiveKind(file);
  if (kind === "zip") throw new BackupError(`${file} is a zip-format backup (a site set to use zip backups made it): Moodle restores it, but the driver reads only the gzipped tar ones Moodle makes by default.`);
  if (kind !== "tgz") throw new BackupError(`${file} isn't a Moodle backup: an .mbz file is a gzipped archive, and this one isn't.`);
  const stream = createReadStream(file);
  const gunzip = stream.pipe(createGunzip());
  let buffer: Buffer = Buffer.alloc(0);
  let skip = 0;
  let entry: { name: string; type: string; size: number; padded: number } | undefined;
  let longName: string | undefined;
  let first = true;
  try {
    outer: for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
      for (;;) {
        if (skip > 0) {
          const n = Math.min(skip, buffer.length);
          buffer = buffer.subarray(n);
          skip -= n;
          if (skip > 0) break;
          continue;
        }
        if (entry) {
          if (buffer.length < entry.padded) break;
          const data = Buffer.from(buffer.subarray(0, entry.size));
          buffer = buffer.subarray(entry.padded);
          if (entry.type === "L") longName = data.toString("utf8").replace(/\0+$/, "");
          else if (entry.type === "x") longName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"))?.[1] ?? longName;
          else found.set(entry.name, data);
          entry = undefined;
          if (enough?.(found)) break outer;
          continue;
        }
        if (buffer.length < 512) break;
        const header = buffer.subarray(0, 512);
        buffer = buffer.subarray(512);
        if (header.every((byte) => byte === 0)) break outer; // The archive's end.
        if (!validHeader(header)) {
          throw new BackupError(first ? `${file} isn't a Moodle backup: it's gzipped, but not an archive of files.` : `${file} is damaged: its archive breaks off.`);
        }
        first = false;
        const type = String.fromCharCode(header[156]!);
        const size = octal(header.subarray(124, 136));
        const padded = Math.ceil(size / 512) * 512;
        const prefix = header.subarray(257, 262).toString("latin1") === "ustar" ? cString(header.subarray(345, 500)) : "";
        const plain = cString(header.subarray(0, 100));
        const name = (longName ?? (prefix ? `${prefix}/${plain}` : plain)).replace(/^\.\//, "");
        if (type !== "L" && type !== "x") longName = undefined;
        if (type === "L" || type === "x" || ((type === "0" || type === "\0") && wanted(name))) entry = { name, type, size, padded };
        else skip = padded;
      }
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError(`${file} isn't a Moodle backup, or it's damaged: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stream.destroy();
  }
  return found;
}

/**
 * Copies a gzipped tar to `destFile`, every entry as it was (its header's bytes too) except those
 * `replacements` gives new contents for: their header keeps its name, mode and times, with the new
 * size and checksum. Streams, so a backup of any size takes little memory; written to a temporary
 * file first and renamed, so `destFile` may be `file` itself, and a failure leaves no half file.
 */
export async function rewriteTar(file: string, destFile: string, replacements: Map<string, Buffer>): Promise<void> {
  if ((await archiveKind(file)) !== "tgz") throw new BackupError(`${file} isn't a Moodle backup the driver can read: an .mbz file is a gzipped archive, and this one isn't.`);
  const temporary = `${destFile}.${process.pid}-${Date.now()}.part`;
  const source = createReadStream(file);
  const gunzip = source.pipe(createGunzip());
  const gzip = createGzip();
  const output = createWriteStream(temporary);
  const written = pipeline(gzip, output);
  // Back pressure: waits for the compressor when it asks to.
  const write = async (bytes: Buffer) => {
    if (!gzip.write(bytes)) await once(gzip, "drain");
  };
  let buffer: Buffer = Buffer.alloc(0);
  let copy = 0;
  let skip = 0;
  let longName: string | undefined;
  let pendingLong: { type: string; size: number; padded: number; header: Buffer } | undefined;
  try {
    outer: for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
      for (;;) {
        if (copy > 0 || skip > 0) {
          const n = Math.min(copy || skip, buffer.length);
          if (copy > 0) {
            await write(buffer.subarray(0, n));
            copy -= n;
          } else skip -= n;
          buffer = buffer.subarray(n);
          if (copy > 0 || skip > 0) break;
          continue;
        }
        if (pendingLong) {
          // A long name's own entry: kept to name the next one, and copied as it is.
          if (buffer.length < pendingLong.padded) break;
          const data = buffer.subarray(0, pendingLong.size).toString("utf8");
          longName = pendingLong.type === "L" ? data.replace(/\0+$/, "") : (/(?:^|\n)\d+ path=([^\n]*)\n/.exec(data)?.[1] ?? longName);
          await write(Buffer.concat([pendingLong.header, buffer.subarray(0, pendingLong.padded)]));
          buffer = buffer.subarray(pendingLong.padded);
          pendingLong = undefined;
          continue;
        }
        if (buffer.length < 512) break;
        const header = Buffer.from(buffer.subarray(0, 512));
        buffer = buffer.subarray(512);
        if (header.every((byte) => byte === 0)) break outer;
        if (!validHeader(header)) throw new BackupError(`${file} is damaged: its archive breaks off.`);
        const type = String.fromCharCode(header[156]!);
        const size = octal(header.subarray(124, 136));
        const padded = Math.ceil(size / 512) * 512;
        if (type === "L" || type === "x") {
          pendingLong = { type, size, padded, header };
          continue;
        }
        const prefix = header.subarray(257, 262).toString("latin1") === "ustar" ? cString(header.subarray(345, 500)) : "";
        const plain = cString(header.subarray(0, 100));
        const name = (longName ?? (prefix ? `${prefix}/${plain}` : plain)).replace(/^\.\//, "");
        longName = undefined;
        const replacement = (type === "0" || type === "\0") && replacements.get(name);
        if (replacement) {
          header.write(`${replacement.length.toString(8).padStart(11, "0")}\0`, 124, 12, "latin1");
          header.write("        ", 148, 8, "latin1");
          let sum = 0;
          for (const byte of header) sum += byte;
          header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "latin1");
          await write(Buffer.concat([header, replacement, Buffer.alloc((512 - (replacement.length % 512)) % 512)]));
          skip = padded;
        } else {
          await write(header);
          copy = padded;
        }
      }
    }
    if (copy > 0 || skip > 0 || pendingLong) throw new BackupError(`${file} is damaged: its archive breaks off.`);
    await write(Buffer.alloc(1024)); // The archive's end.
    gzip.end();
    await written;
    await rename(temporary, destFile);
  } catch (error) {
    gzip.destroy();
    await written.catch(() => undefined);
    await rm(temporary, { force: true });
    if (error instanceof BackupError) throw error;
    throw new BackupError(`${file} couldn't be rewritten into ${destFile}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    source.destroy();
  }
}

/** Whether a file is a gzipped archive (Moodle's default .mbz), a zip (`usezipbackups`) or neither, by its first bytes. */
export async function archiveKind(file: string): Promise<"tgz" | "zip" | "other"> {
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    if (bytesRead < 2) return "other";
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return "tgz";
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "zip";
    return "other";
  } finally {
    await handle.close();
  }
}

const cString = (bytes: Buffer) => {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end === -1 ? bytes.length : end).toString("utf8");
};

/** A tar number: octal text, or base-256 for big sizes (the high bit set). */
function octal(bytes: Buffer): number {
  if (bytes[0]! & 0x80) return bytes.subarray(1).reduce((n, byte) => n * 256 + byte, 0);
  return parseInt(cString(bytes).trim() || "0", 8);
}

/** A tar header's checksum: the sum of its bytes, the checksum's own as spaces. */
function validHeader(header: Buffer): boolean {
  const stored = parseInt(cString(header.subarray(148, 156)).trim(), 8);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
  return stored === sum;
}

/** An element of an XML file: its name, attributes, child elements and text. */
export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) =>
    code[0] === "#" ? String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : (ENTITIES[code] ?? whole),
  );

/** The XML Moodle writes in a backup (elements, attributes, text, CDATA), as a tree; refuses what isn't well formed. */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "", attributes: {}, children: [], text: "" };
  const stack = [root];
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  let at = 0;
  while ((match = tag.exec(xml)) !== null) {
    if (match.index !== at) throw new Error(`XML not well formed at ${at}`);
    at = tag.lastIndex;
    const current = stack[stack.length - 1]!;
    const [, cdata, closing, opening, attributes, selfClosing, text] = match;
    if (cdata !== undefined) current.text += cdata;
    else if (text !== undefined) current.text += decodeXml(text);
    else if (closing !== undefined) {
      if (stack.length === 1 || current.name !== closing) throw new Error(`XML not well formed: </${closing}> closes <${current.name}>`);
      stack.pop();
    } else if (opening !== undefined) {
      const element: XmlElement = { name: opening, attributes: {}, children: [], text: "" };
      for (const [, key, quoted] of (attributes ?? "").matchAll(/([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g)) element.attributes[key!] = decodeXml(quoted!.slice(1, -1));
      current.children.push(element);
      if (!selfClosing) stack.push(element);
    }
  }
  if (at !== xml.length || stack.length !== 1) throw new Error("XML not well formed: it ends early");
  const [top] = root.children;
  if (!top) throw new Error("XML without elements");
  return top;
}

/** The first child element named `name`, following a path ("information/contents"). */
export function child(element: XmlElement | undefined, path: string): XmlElement | undefined {
  return path.split("/").reduce<XmlElement | undefined>((at, name) => at?.children.find((c) => c.name === name), element);
}

/** The child elements named `name` of the element at `path`. */
export const childrenOf = (element: XmlElement | undefined, path: string, name: string): XmlElement[] => child(element, path)?.children.filter((c) => c.name === name) ?? [];

/** The trimmed text of the element at `path`; undefined when it's missing or holds `$@NULL@$` (Moodle's null). */
export function textOf(element: XmlElement | undefined, path: string): string | undefined {
  const text = child(element, path)?.text.trim();
  return text === undefined || text === "$@NULL@$" ? undefined : text;
}

/** An activity a backup holds (or lists without holding it: `included` false). */
export interface BackupActivityInfo {
  /** Its course module id on the original site. */
  id: number;
  /** Its section's id on the original site. */
  sectionId: number;
  module: string;
  title: string;
  /** Its folder in the backup ("activities/page_12"). */
  directory: string;
  included: boolean;
}

/** A section a backup holds (or lists without holding it). */
export interface BackupSectionInfo {
  /** Its id on the original site. */
  id: number;
  title: string;
  /** Its folder in the backup ("sections/section_5"). */
  directory: string;
  included: boolean;
  /** For a subsection (Moodle 5), the course module of the subsection activity that holds it. */
  parentActivityId?: number;
  /** From its `section.xml`: its number in the original course, the name given to it (none: the format's default), its description (HTML, with Moodle's backup placeholders), whether students saw it. */
  number?: number;
  name?: string;
  summary?: string;
  visible?: boolean;
}

/** What `moodle_backup.xml` says of a backup, the parts the driver reads. */
export interface BackupInfo {
  /** A backup of a whole course (or part of one: `course` too), one section or one activity. */
  type: "course" | "section" | "activity";
  /** Moodle's version number on the site that made it ("2026042004.00"). */
  moodleVersion: string;
  /** Moodle's release on that site ("5.2.4 (Build: 20261005)"). */
  moodleRelease: string;
  /** The original site's address. */
  originalSite?: string;
  originalCourse: { id: number; fullName?: string; shortName?: string; format?: string };
  sections: BackupSectionInfo[];
  activities: BackupActivityInfo[];
  /** The backup's root settings ("users", "logs"…), as Moodle wrote them ("1", "0", or text). */
  settings: Record<string, string>;
}

/** Parses `moodle_backup.xml`. */
export function parseBackupInfo(xml: string, file: string): BackupInfo {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    throw new BackupError(`${file} is damaged: its moodle_backup.xml can't be read (${error instanceof Error ? error.message : String(error)}).`);
  }
  const info = child(root, "information");
  if (root.name !== "moodle_backup" || !info) throw new BackupError(`${file} isn't a Moodle backup: its moodle_backup.xml isn't one.`);
  const settings: Record<string, string> = {};
  const sectionIncluded = new Map<string, boolean>();
  const activityIncluded = new Map<string, boolean>();
  for (const setting of childrenOf(info, "settings", "setting")) {
    const level = textOf(setting, "level");
    const name = textOf(setting, "name") ?? "";
    const value = textOf(setting, "value") ?? "";
    if (level === "root") settings[name] = value;
    else if (level === "section" && name.endsWith("_included")) sectionIncluded.set(textOf(setting, "section") ?? "", value === "1");
    else if (level === "activity" && name.endsWith("_included")) activityIncluded.set(textOf(setting, "activity") ?? "", value === "1");
  }
  const lastPart = (directory: string) => directory.split("/").pop() ?? "";
  const sections = childrenOf(info, "contents/sections", "section").map((section): BackupSectionInfo => {
    const directory = textOf(section, "directory") ?? "";
    const parent = Number(textOf(section, "parentcmid"));
    return {
      id: Number(textOf(section, "sectionid")),
      title: textOf(section, "title") ?? "",
      directory,
      included: sectionIncluded.get(lastPart(directory)) ?? true,
      ...(parent ? { parentActivityId: parent } : {}),
    };
  });
  const activities = childrenOf(info, "contents/activities", "activity").map((activity): BackupActivityInfo => {
    const directory = textOf(activity, "directory") ?? "";
    return {
      id: Number(textOf(activity, "moduleid")),
      sectionId: Number(textOf(activity, "sectionid")),
      module: textOf(activity, "modulename") ?? "",
      title: textOf(activity, "title") ?? "",
      directory,
      included: activityIncluded.get(lastPart(directory)) ?? true,
    };
  });
  const type = textOf(info, "details/detail/type");
  return {
    type: type === "section" || type === "activity" ? type : "course",
    moodleVersion: textOf(info, "moodle_version") ?? "",
    moodleRelease: textOf(info, "moodle_release") ?? "",
    originalSite: textOf(info, "original_wwwroot"),
    originalCourse: {
      id: Number(textOf(info, "original_course_id")),
      fullName: textOf(info, "original_course_fullname"),
      shortName: textOf(info, "original_course_shortname"),
      format: textOf(info, "original_course_format"),
    },
    sections,
    activities,
    settings,
  };
}

const SECTION_XML = /^sections\/section_\d+\/section\.xml$/;

/** Adds what each section's `section.xml` says (number, name, description, visibility) to the backup's sections. */
export function addSectionDetails(info: BackupInfo, entries: Map<string, Buffer>): void {
  for (const section of info.sections) {
    const xml = entries.get(`${section.directory}/section.xml`);
    if (!xml) continue;
    let element: XmlElement;
    try {
      element = parseXml(xml.toString("utf8"));
    } catch {
      continue;
    }
    const number = Number(textOf(element, "number"));
    if (!Number.isNaN(number)) section.number = number;
    const name = textOf(element, "name");
    if (name) section.name = name;
    const summary = textOf(element, "summary");
    if (summary) section.summary = summary;
    const visible = textOf(element, "visible");
    if (visible !== undefined) section.visible = visible !== "0";
  }
}

/** Reads a backup's `moodle_backup.xml` from its file, with its sections' own `section.xml`. */
export async function readBackupInfo(file: string): Promise<BackupInfo> {
  await checkLocalFiles([file]);
  let info: BackupInfo | undefined;
  // Every section's file read once the description says which there are.
  const entries = await readTarEntries(
    file,
    (name) => name === "moodle_backup.xml" || SECTION_XML.test(name),
    (found) => {
      const xml = found.get("moodle_backup.xml");
      if (!xml) return false;
      info ??= parseBackupInfo(xml.toString("utf8"), file);
      return info.sections.every((section) => found.has(`${section.directory}/section.xml`));
    },
  );
  const xml = entries.get("moodle_backup.xml");
  if (!xml) throw new BackupError(`${file} isn't a Moodle backup: it has no moodle_backup.xml.`);
  info ??= parseBackupInfo(xml.toString("utf8"), file);
  addSectionDetails(info, entries);
  return info;
}

/** "5.2.4 (Build: …)" as [5, 2]; undefined when it isn't a release. */
export function branchOfRelease(release: string): [number, number] | undefined {
  const match = /^(\d+)\.(\d+)/.exec(release.trim());
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

/** Moodle's branch numbers ("39", "311", "405", "502", as in its documentation's links) as [major, minor]. */
export function branchOfNumber(branch: string): [number, number] | undefined {
  if (!/^\d{2,3}$/.test(branch)) return undefined;
  if (branch.length === 2) return [Number(branch[0]), Number(branch[1])];
  // 3.10 and 3.11 are "310" and "311"; from 4.0 on, the minor takes two digits ("400", "502").
  return branch[0] === "3" ? [3, Number(branch.slice(1))] : [Number(branch[0]), Number(branch.slice(1))];
}

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { BackupError } from "../../../src/index.js";
import { branchOfNumber, branchOfRelease, parseXml, readBackupInfo, readTarEntries } from "../../../src/areas/backup/mbz.js";
import { selectionOf } from "../../../src/areas/backup/backup.js";
import { writeTgz } from "./tgz.js";

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mbz-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const file = async (name: string, content: Buffer) => {
  const at = path.join(dir, name);
  await writeFile(at, content);
  return at;
};

const MOODLE_BACKUP = `<?xml version="1.0" encoding="UTF-8"?>
<moodle_backup>
  <information>
    <moodle_version>2026042004</moodle_version>
    <moodle_release>5.2.4 (Build: 20261005)</moodle_release>
    <original_wwwroot>http://campus.test</original_wwwroot>
    <original_course_id>3</original_course_id>
    <original_course_fullname>Programaci&#243;n &amp; datos</original_course_fullname>
    <details><detail backup_id="b"><type>course</type></detail></details>
    <contents>
      <activities>
        <activity><moduleid>12</moduleid><sectionid>5</sectionid><modulename>page</modulename><title><![CDATA[Loops <1>]]></title><directory>activities/page_12</directory></activity>
        <activity><moduleid>13</moduleid><sectionid>5</sectionid><modulename>quiz</modulename><title>Quiz</title><directory>activities/quiz_13</directory></activity>
      </activities>
      <sections><section><sectionid>5</sectionid><title>1</title><directory>sections/section_5</directory><parentcmid></parentcmid></section></sections>
    </contents>
    <settings>
      <setting><level>root</level><name>users</name><value>0</value></setting>
      <setting><level>activity</level><activity>quiz_13</activity><name>quiz_13_included</name><value>0</value></setting>
    </settings>
  </information>
</moodle_backup>`;

describe("readBackupInfo", () => {
  it("reads a backup's description and its sections, from any place in the archive", async () => {
    const long = `activities/${"x".repeat(120)}/module.xml`;
    const mbz = await file(
      "a.mbz",
      writeTgz([
        [long, "<module/>"],
        ["sections/section_5/section.xml", '<section id="5"><number>2</number><name>Unit &lt;2&gt;</name><summary>$@NULL@$</summary><visible>0</visible></section>'],
        ["moodle_backup.xml", MOODLE_BACKUP],
      ]),
    );
    const info = await readBackupInfo(mbz);
    assert.equal(info.type, "course");
    assert.equal(info.moodleRelease, "5.2.4 (Build: 20261005)");
    assert.deepEqual(info.originalCourse, { id: 3, fullName: "Programación & datos", shortName: undefined, format: undefined });
    assert.deepEqual(
      info.activities.map((a) => [a.id, a.module, a.title, a.included]),
      [
        [12, "page", "Loops <1>", true],
        [13, "quiz", "Quiz", false],
      ],
    );
    assert.deepEqual(info.sections, [{ id: 5, title: "1", directory: "sections/section_5", included: true, number: 2, name: "Unit <2>", visible: false }]);
    assert.deepEqual(info.settings, { users: "0" });
    // A name longer than 100 characters, in the header's prefix.
    assert.ok((await readTarEntries(mbz, () => true)).has(long));
  });

  it("refuses what isn't a Moodle backup, saying why", async () => {
    const reject = async (name: string, content: Buffer, message: RegExp) => assert.rejects(readBackupInfo(await file(name, content)), (error: Error) => error instanceof BackupError && message.test(error.message));
    await reject("plain.mbz", Buffer.from("hello"), /isn't a Moodle backup: an \.mbz file is a gzipped archive/);
    await reject("zip.mbz", Buffer.from("PK\x03\x04rest"), /zip-format backup/);
    await reject("gzip.mbz", gzipSync(Buffer.alloc(2048, 7)), /gzipped, but not an archive/);
    await reject("empty.mbz", writeTgz([["readme.txt", "hi"]]), /has no moodle_backup\.xml/);
    await reject("other.mbz", writeTgz([["moodle_backup.xml", "<other/>"]]), /moodle_backup\.xml isn't one/);
    await reject("broken.mbz", writeTgz([["moodle_backup.xml", "<moodle_backup><information>"]]), /is damaged/);
    await reject("cut.mbz", writeTgz([["moodle_backup.xml", MOODLE_BACKUP]]).subarray(0, 60), /isn't a Moodle backup, or it's damaged/);
  });
});

describe("parseXml", () => {
  it("reads elements, attributes, entities and CDATA, and refuses what isn't well formed", () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b>t&#x41;</b><c/><![CDATA[<raw>]]></a>');
    assert.deepEqual([root.name, root.attributes, root.children.map((c) => c.name), root.children[0]!.text, root.text], ["a", { x: "1 & 2" }, ["b", "c"], "tA", "<raw>"]);
    assert.throws(() => parseXml("<a><b></a>"));
    assert.throws(() => parseXml("<a>"));
  });
});

describe("branches", () => {
  it("reads Moodle's releases and branch numbers alike", () => {
    assert.deepEqual(branchOfRelease("5.2.4 (Build: 20261005)"), [5, 2]);
    assert.deepEqual(branchOfRelease("3.11.18+"), [3, 11]);
    assert.equal(branchOfRelease("unknown"), undefined);
    assert.deepEqual(["39", "311", "405", "502"].map(branchOfNumber), [[3, 9], [3, 11], [4, 5], [5, 2]]);
  });
});

describe("selectionOf", () => {
  it("takes a section with everything in it, an activity with its section, a subsection with its content", () => {
    const cm = (id: string, sectionid: string, delegatesectionid?: string) => ({ id, sectionid, delegatesectionid, name: "", module: "page", visible: true });
    const state = { cm: [cm("1", "10"), cm("2", "10"), cm("3", "11"), cm("4", "11", "12"), cm("5", "12"), cm("6", "13")] };
    const { sectionIds, activityIds } = selectionOf(state, { sections: [10], activities: [4] });
    assert.deepEqual([[...sectionIds].sort(), [...activityIds].sort()], [[10, 11, 12], [1, 2, 4, 5]]);
  });
});

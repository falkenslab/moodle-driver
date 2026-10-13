// anonymizeBackup on real backups made on the sandbox (Moodle 5.2.4, the fixtures) and on made-up
// ones with everything Moodle writes about people and the origin. No Moodle, no browser.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ANONYMOUS, BackupError, anonymizeBackup, backupContents } from "../../../src/index.js";
import { readTgz, writeTgz } from "./tgz.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

/** A backup with a page, a file, questions and a badge, as Moodle 5.2 writes them (trimmed), from course 105 of http://localhost:8080. */
function madeUp(users = "0"): [string, string][] {
  const backup = `<?xml version="1.0" encoding="UTF-8"?>
<moodle_backup>
  <information>
    <name>backup-moodle2-course-105-algebra-20261013-2315-nu.mbz</name>
    <moodle_version>2026042004</moodle_version>
    <moodle_release>5.2.4 (Build: 20261005)</moodle_release>
    <original_wwwroot>http://localhost:8080</original_wwwroot>
    <original_site_identifier_hash>815b536c5eba7732edfe049ffa718351</original_site_identifier_hash>
    <original_course_id>105</original_course_id>
    <original_course_format>topics</original_course_format>
    <original_course_fullname>Algebra &amp; logic</original_course_fullname>
    <original_course_shortname>algebra</original_course_shortname>
    <original_course_contextid>972</original_course_contextid>
    <details><detail backup_id="b1"><type>course</type></detail></details>
    <contents>
      <activities><activity><moduleid>788</moduleid><sectionid>574</sectionid><modulename>page</modulename><title>Intro</title><directory>activities/page_788</directory></activity></activities>
      <sections><section><sectionid>574</sectionid><title>0</title><directory>sections/section_574</directory></section></sections>
      <course>
        <courseid>105</courseid>
        <title>algebra</title>
        <directory>course</directory>
      </course>
    </contents>
    <settings>
      <setting><level>root</level><name>filename</name><value>backup-moodle2-course-105-algebra-20261013-2315-nu.mbz</value></setting>
      <setting><level>root</level><name>users</name><value>${users}</value></setting>
    </settings>
  </information>
</moodle_backup>`;
  const page = `<activity id="5" moduleid="788" modulename="page" contextid="974"><page id="5"><name>Intro</name><content>&lt;p&gt;&lt;a href="$@COURSEVIEWBYID*105@$"&gt;Course&lt;/a&gt; &lt;a href="$@FORUMINDEX*105@$"&gt;forums&lt;/a&gt; &lt;a href="$@PAGEVIEWBYID*105@$"&gt;page 105&lt;/a&gt; &lt;a href="http://localhost:8080/user/profile.php?id=3"&gt;me&lt;/a&gt; &lt;a href="http://localhost:80801/x"&gt;other&lt;/a&gt; &lt;img src="@@PLUGINFILE@@/dot.png"&gt;&lt;/p&gt;</content></page></activity>`;
  const files = `<files><file id="1"><contenthash>27</contenthash><contextid>974</contextid><component>mod_page</component><filearea>content</filearea><filename>dot.png</filename><userid>3</userid><source>dot.png</source><author>Profesor Demo</author><license>unknown</license></file>
<file id="2"><contenthash>da</contenthash><contextid>974</contextid><filename>.</filename><userid>$@NULL@$</userid><author>$@NULL@$</author></file></files>`;
  const questions = `<question_categories><question_category id="1"><name>Default for algebra</name><contextid>972</contextid><contextlevel>50</contextlevel><info>The default category for questions shared in context 'Algebra &amp; logic'.</info><stamp>localhost:8080+261013225433+oNq8QS</stamp>
<question_bank_entries><question_bank_entry id="2"><ownerid>3</ownerid><question_version><question_versions id="3"><version>1</version><questions><question id="4"><name>Q</name><qtype>truefalse</qtype><stamp>localhost:8080+261013225444+PsqRk3</stamp><version>localhost:8080+261013225444+Zz9Aa1</version><createdby>3</createdby><modifiedby>4</modifiedby></question></questions></question_versions></question_version></question_bank_entry></question_bank_entries></question_category></question_categories>`;
  const badges = `<badges><badge id="1"><name>Star</name><issuername>IES Example</issuername><issuerurl>http://localhost:8080</issuerurl><issuercontact>teacher@example.org</issuercontact><usercreated>3</usercreated><usermodified>3</usermodified><config>{"url":"http:\\/\\/localhost:8080\\/badges"}</config></badge></badges>`;
  const course = `<course id="105" contextid="972"><shortname>algebra</shortname><fullname>Algebra &amp; logic</fullname><idnumber>ALG-1</idnumber><summary>Algebra.</summary><category id="4"><name>Maths, IES Example</name><description>$@NULL@$</description></category></course>`;
  const entries: [string, string][] = [
    ["moodle_backup.xml", backup],
    ["activities/page_788/page.xml", page],
    ["files.xml", files],
    ["questions.xml", questions],
    ["badges.xml", badges],
    ["course/course.xml", course],
    ["moodle_backup.log", "[info] backup by teacher\n"],
    ["files/27/27", "the image's bytes"],
  ];
  const index = `Moodle archive file index. Count: ${entries.length}\n${entries.map(([name, content]) => `${name}\tf\t${Buffer.byteLength(content)}\t1791932125`).join("\n")}\n`;
  return [[".ARCHIVE_INDEX", index], ...entries];
}

describe("anonymizeBackup", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "anonymous-"));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("clears every person, the site and the course from a made-up backup, and nothing else", async () => {
    const file = path.join(dir, "made-up.mbz");
    await writeFile(file, writeTgz(madeUp()));
    const before = await backupContents(file);
    assert.deepEqual(
      before.identifies.map((i) => `${i.file} ${i.field} ${i.value}`).sort(),
      [
        "activities/page_788/page.xml text http://localhost:8080",
        "badges.xml issuercontact teacher@example.org",
        "badges.xml issuername IES Example",
        "badges.xml issuerurl http://localhost:8080",
        "badges.xml text http://localhost:8080",
        "badges.xml usercreated 3",
        "badges.xml usermodified 3",
        "course/course.xml category Maths, IES Example",
        "course/course.xml fullname Algebra &amp; logic",
        "course/course.xml id 105",
        "course/course.xml idnumber ALG-1",
        "course/course.xml shortname algebra",
        "files.xml author Profesor Demo",
        "files.xml userid 3",
        "moodle_backup.log log the backup's log",
        "moodle_backup.xml courseid 105",
        "moodle_backup.xml filename backup-moodle2-course-105-algebra-20261013-2315-nu.mbz",
        "moodle_backup.xml name backup-moodle2-course-105-algebra-20261013-2315-nu.mbz",
        "moodle_backup.xml original_course_fullname Algebra &amp; logic",
        "moodle_backup.xml original_course_id 105",
        "moodle_backup.xml original_course_shortname algebra",
        "moodle_backup.xml original_site_identifier_hash 815b536c5eba7732edfe049ffa718351",
        "moodle_backup.xml original_wwwroot http://localhost:8080",
        "moodle_backup.xml title algebra",
        "questions.xml createdby 3",
        "questions.xml info The default category for questions shared in context 'Algebra &amp; logic'.",
        "questions.xml modifiedby 4",
        "questions.xml name Default for algebra",
        "questions.xml ownerid 3",
        "questions.xml stamp localhost:8080+261013225433+oNq8QS",
        "questions.xml stamp localhost:8080+261013225444+PsqRk3",
        "questions.xml version localhost:8080+261013225444+Zz9Aa1",
      ],
    );

    const dest = path.join(dir, "anonymous.mbz");
    const { changed, file: written, cleared } = await anonymizeBackup(file, dest);
    assert.match(changed, /made-up\.mbz written anonymous to anonymous\.mbz/);
    assert.equal(written.path, dest);
    assert.equal(cleared.length, before.identifies.length);
    const after = await backupContents(dest);
    assert.deepEqual(after.identifies, []);
    assert.deepEqual(after.original, { site: ANONYMOUS.site, courseId: 0, courseFullName: "Restored course", courseShortName: "restored", format: "topics" });
    assert.deepEqual(after.activities, before.activities);

    const entries = new Map(readTgz(await readFile(dest)).map(([name, data]) => [name, data.toString("utf8")]));
    const original = new Map(madeUp());
    assert.deepEqual([...entries.keys()], [...original.keys()]);
    assert.equal(entries.get("files/27/27"), "the image's bytes");
    // Links whose id is the course's follow the anonymous course; an activity's with the same number doesn't.
    const page = entries.get("activities/page_788/page.xml")!;
    assert.match(page, /\$@COURSEVIEWBYID\*0@\$.*\$@FORUMINDEX\*0@\$.*\$@PAGEVIEWBYID\*105@\$/);
    assert.match(page, /href="https:\/\/anonymous\.invalid\/user\/profile\.php\?id=3"/);
    assert.match(page, /http:\/\/localhost:80801\/x/, "another site's address stays");
    assert.match(page, /@@PLUGINFILE@@\/dot\.png/);
    assert.match(entries.get("files.xml")!, /<userid>0<\/userid>.*<author>\$@NULL@\$<\/author>.*<userid>\$@NULL@\$<\/userid>/s);
    const questions = entries.get("questions.xml")!;
    assert.match(questions, /<name>Default for Restored course<\/name>/);
    assert.match(questions, /<stamp>anonymous\+261013225433\+oNq8QS<\/stamp>.*<version>1<\/version>.*<stamp>anonymous\+261013225444\+PsqRk3<\/stamp><version>anonymous\+261013225444\+Zz9Aa1<\/version><createdby>0<\/createdby><modifiedby>0<\/modifiedby>/s);
    assert.match(entries.get("badges.xml")!, /<issuername><\/issuername><issuerurl><\/issuerurl><issuercontact><\/issuercontact>.*"url":"https:\\\/\\\/anonymous\.invalid\\\/badges"/s);
    assert.match(entries.get("course/course.xml")!, /^<course id="0" contextid="972"><shortname>restored<\/shortname><fullname>Restored course<\/fullname><idnumber><\/idnumber><summary>Algebra\.<\/summary><category id="4"><name><\/name>/);
    assert.equal(entries.get("moodle_backup.log"), "");
    // The archive's index gives each file's new size.
    for (const line of entries.get(".ARCHIVE_INDEX")!.split("\n").slice(1).filter(Boolean)) {
      const [name, , size] = line.split("\t");
      assert.equal(Number(size), Buffer.byteLength(entries.get(name!)!), name);
    }
  });

  it("anonymizes the backups made on the sandbox, in place too, their content kept", async () => {
    for (const name of ["course.mbz", "part.mbz", "section.mbz", "activity.mbz"]) {
      const file = path.join(dir, name);
      await copyFile(fixture(name), file);
      const before = await backupContents(file);
      assert.ok(before.identifies.some((i) => i.field === "original_wwwroot"), name);
      await anonymizeBackup(file, file);
      const after = await backupContents(file);
      assert.deepEqual(after.identifies, [], name);
      assert.equal(after.original.site, ANONYMOUS.site);
      assert.deepEqual([after.type, after.moodle, after.sections, after.activities, after.plugins, after.withUsers], [before.type, before.moodle, before.sections, before.activities, before.plugins, before.withUsers], name);
      // Every entry but the XML it rewrote, as it was.
      const changed = new Set(["moodle_backup.xml", "course/course.xml", ".ARCHIVE_INDEX"]);
      const old = readTgz(await readFile(fixture(name)));
      const now = new Map(readTgz(await readFile(file)));
      assert.deepEqual([...now.keys()], old.map(([entry]) => entry));
      for (const [entry, data] of old) if (!changed.has(entry)) assert.deepEqual(now.get(entry), data, `${name}: ${entry}`);
    }
  });

  it("refuses a backup with users' data, a file that isn't a backup, and a relative destination", async () => {
    const file = path.join(dir, "users.mbz");
    await writeFile(file, writeTgz(madeUp("1")));
    await assert.rejects(anonymizeBackup(file, path.join(dir, "out.mbz")), (error: Error) => error instanceof BackupError && /holds people's data/.test(error.message));
    await assert.rejects(anonymizeBackup(fixture("not-a-backup.mbz"), path.join(dir, "out.mbz")), BackupError);
    await assert.rejects(anonymizeBackup(fixture("activity.mbz"), "out.mbz"), { code: "invalid-input" });
    await assert.rejects(readFile(path.join(dir, "out.mbz")), { code: "ENOENT" });
  });
});

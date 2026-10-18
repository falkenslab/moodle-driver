// Runs the regression suite against the Moodle sandbox (test/sandbox/), in Docker like every test.
//
//   npm run test:sandbox                                  every file
//   npm run test:sandbox -- test/sandbox/forums.sandbox.ts   some
//   npm run test:sandbox -- --moodle 4.5                  against the sandbox's Moodle 4.5 site
//
// The accounts come from the sandbox itself (`node manage.mjs info --json` in ../moodle-sandbox, or
// MOODLE_SANDBOX_DIR) into a temporary folder only the person can read, mounted at /sandbox with the
// browser profiles; the folder is deleted whatever happens. Nothing prints or stores a password.
// The sandbox runs Moodle's cron in a container of its own, so backups, copies and restores run as
// on a real site.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
// The sandbox sits beside the repository's main checkout, also when this runs from a git worktree.
const commonDir = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).stdout.trim();
const mainCheckout = commonDir ? path.dirname(commonDir) : root;
const sandboxDir = path.resolve(mainCheckout, process.env.MOODLE_SANDBOX_DIR ?? "../moodle-sandbox");

// `--moodle <series>` picks one of the sandbox's sites (its 5.2 one without it), `--grep <pattern>`
// runs only the tests whose name matches (node's --test-name-pattern), to check a new block alone.
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const moodle = option("--moodle");
const grep = option("--grep");
const files = args;

const info = spawnSync(process.execPath, ["manage.mjs", "info", "--json", ...(moodle ? ["--moodle", moodle] : [])], { cwd: sandboxDir, encoding: "utf8" });
if (info.status !== 0) {
  console.error(`The sandbox isn't ready (${sandboxDir}${moodle ? `, Moodle ${moodle}` : ""}): start it with "npm run up${moodle ? ` -- --moodle ${moodle}` : ""}" there.`);
  process.exit(2);
}
const sandbox = JSON.parse(info.stdout);
// The seeded students log in; the first, Lucía, is the suite's student.
const student = sandbox.students?.[0];
if (!student) {
  console.error('The sandbox has no seeded students: run "npm run activity" there.');
  process.exit(2);
}

// The accounts' browser profiles outlive the run, so later runs skip logging in (minutes on a busy
// sandbox): one folder per checkout, since a profile opens in one browser at a time and agents run
// from worktrees in parallel. They hold the sandbox's session cookies, never a password.
// One site's sessions aren't another's: the 5.2 site keeps its folder name, another series gets its own.
const profiles = path.join(process.env.MOODLE_SANDBOX_PROFILES ?? path.join(homedir(), ".moodle-driver-sandbox"), createHash("sha256").update(root + (moodle && moodle !== "5.2" ? `#${moodle}` : "")).digest("hex").slice(0, 12));

// The content course every read uses ("mcp-content") was filled by hand on the 5.2 site; its ids
// are found by name, so another site without it gets ids no record has rather than someone else's.
const site = new URL(sandbox.url.endsWith("/") ? sandbox.url : `${sandbox.url}/`);
const project = sandbox.project ?? "moodle-sandbox";
const sql = "select c.id, cm.id, gi.id from mdl_course c left join mdl_assign a on a.course = c.id and a.name = 'Tarea MCP' left join mdl_course_modules cm on cm.instance = a.id and cm.module = (select id from mdl_modules where name = 'assign') left join mdl_grade_items gi on gi.itemmodule = 'assign' and gi.iteminstance = a.id where c.shortname = 'mcp-content'";
const found = spawnSync("docker", ["exec", `${project}-db-1`, "sh", "-c", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F, -c "${sql}"`], { encoding: "utf8" });
const [contentCourseId, contentAssignmentId, contentAssignmentItemId] = (found.stdout ?? "").trim().split(",").map((id) => Number(id) || 999_999_999);
if (!found.stdout?.trim()) console.error(`This sandbox has no content course (mcp-content): the checks that read it fail.`);
mkdirSync(profiles, { recursive: true, mode: 0o700 });

const work = mkdtempSync(path.join(tmpdir(), "moodle-driver-sandbox-"));
let status;
try {
  chmodSync(work, 0o700);
  const accounts = { admin: sandbox.admin, teacher: sandbox.teacher, student, sandboxCourseId: sandbox.course.id, site: site.href, series: sandbox.moodle?.series, contentCourseId, contentAssignmentId, contentAssignmentItemId };
  writeFileSync(path.join(work, "accounts.json"), JSON.stringify(accounts), { mode: 0o600 });

  const pattern = grep ? ` --test-name-pattern='${grep.replaceAll("'", "'\\''")}'` : "";
  const command = [
    "bash",
    "-c",
    [
      // One file at a time: they share the accounts' sessions.
      `npx tsx --test --test-concurrency=1${pattern} --test-reporter=spec --test-reporter-destination=stdout --test-reporter=tap --test-reporter-destination=/sandbox/report.tap ${files.length > 0 ? files.map((f) => `'${f}'`).join(" ") : "'test/sandbox/**/*.sandbox.ts'"}; code=$?`,
      `npx tsx test/sandbox/summary.ts /sandbox/report.tap${files.length > 0 ? " --partial" : ""} || code=1`,
      "exit $code",
    ].join("; "),
  ];
  const child = spawn(process.execPath, [path.join(root, "scripts", "in-docker.mjs"), ...command], {
    stdio: "inherit",
    env: { ...process.env, MOODLE_DRIVER_DOCKER_MOUNT: `${work}:/sandbox\n${profiles}:/sandbox/profiles`, MOODLE_SANDBOX_PORT: site.port || "80", MOODLE_DRIVER_DOCKER_NETWORK: `${project}_default` },
  });
  status = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(status);

// Runs the regression suite against the Moodle sandbox (test/sandbox/), in Docker like every test.
//
//   npm run test:sandbox                                  every file
//   npm run test:sandbox -- test/sandbox/forums.sandbox.ts   some
//
// The accounts come from the sandbox itself (`node manage.mjs info --json` in ../moodle-sandbox, or
// MOODLE_SANDBOX_DIR) into a temporary folder only the person can read, mounted at /sandbox with the
// browser profiles; the folder is deleted whatever happens. Nothing prints or stores a password.
// The sandbox has no cron: while the suite runs, Moodle's pending ad hoc tasks (backups, copies,
// restores) are run every few seconds, as cron would.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const sandboxDir = path.resolve(root, process.env.MOODLE_SANDBOX_DIR ?? "../moodle-sandbox");

const info = spawnSync(process.execPath, ["manage.mjs", "info", "--json"], { cwd: sandboxDir, encoding: "utf8" });
if (info.status !== 0) {
  console.error(`The sandbox isn't ready (${sandboxDir}): start it with "npm run up" there.`);
  process.exit(2);
}
const sandbox = JSON.parse(info.stdout);
// The seeded students log in; the first, Lucía, is the suite's student.
const student = sandbox.students?.[0];
if (!student) {
  console.error('The sandbox has no seeded students: run "npm run activity" there.');
  process.exit(2);
}

const work = mkdtempSync(path.join(tmpdir(), "moodle-driver-sandbox-"));
let tasks;
let status;
try {
  chmodSync(work, 0o700);
  const accounts = { admin: sandbox.admin, teacher: sandbox.teacher, student, sandboxCourseId: sandbox.course.id };
  writeFileSync(path.join(work, "accounts.json"), JSON.stringify(accounts), { mode: 0o600 });

  // Cron's part: Moodle's pending ad hoc tasks, every 10 seconds, quietly.
  const runTasks = () => spawnSync("docker", ["compose", "exec", "-T", "webserver", "php", "admin/cli/adhoc_task.php", "--execute"], { cwd: sandboxDir, stdio: "ignore" });
  tasks = setInterval(runTasks, 10_000);

  const files = process.argv.slice(2);
  const command = [
    "bash",
    "-c",
    [
      // One file at a time: they share the accounts' sessions.
      `npx tsx --test --test-concurrency=1 --test-reporter=spec --test-reporter-destination=stdout --test-reporter=tap --test-reporter-destination=/sandbox/report.tap ${files.length > 0 ? files.map((f) => `'${f}'`).join(" ") : "'test/sandbox/**/*.sandbox.ts'"}; code=$?`,
      `npx tsx test/sandbox/summary.ts /sandbox/report.tap${files.length > 0 ? " --partial" : ""} || code=1`,
      "exit $code",
    ].join("; "),
  ];
  const child = spawn(process.execPath, [path.join(root, "scripts", "in-docker.mjs"), ...command], {
    stdio: "inherit",
    env: { ...process.env, MOODLE_DRIVER_DOCKER_MOUNT: `${work}:/sandbox` },
  });
  status = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
} finally {
  clearInterval(tasks);
  rmSync(work, { recursive: true, force: true });
}
process.exit(status);

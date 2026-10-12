// Runs a command in a Linux container with Playwright's browsers, so tests and checks never open a
// browser on the developer's desktop. The repository is mounted at /work with node_modules of its
// own (esbuild and tsx have native binaries per platform); with the Moodle sandbox running, the
// container joins its network and localhost:<port> reaches it, as Moodle's URLs expect.
//
//   node scripts/in-docker.mjs npm test
//   node scripts/in-docker.mjs node some-check.mjs
//
// MOODLE_DRIVER_DOCKER_MOUNT="<host dir>:<container dir>" mounts one more folder (checks' profiles); several, one per line.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const IMAGE = "mcr.microsoft.com/playwright:v1.64.0-noble";
const NETWORK = process.env.MOODLE_DRIVER_DOCKER_NETWORK ?? "moodle-sandbox_default";
const SANDBOX = process.env.MOODLE_DRIVER_DOCKER_SANDBOX ?? "webserver:80";
const PORT = process.env.MOODLE_SANDBOX_PORT ?? "8080";

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error("Usage: node scripts/in-docker.mjs <command...>");
  process.exit(2);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const lockHash = createHash("sha256").update(readFileSync(path.join(root, "package-lock.json"))).digest("hex").slice(0, 16);
const sandboxUp = spawnSync("docker", ["network", "inspect", NETWORK], { stdio: "ignore" }).status === 0;

const quoted = command.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(" ");
const script = [
  "set -e",
  // node_modules lives in a volume: install it for Linux when the lock file changes.
  `if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "${lockHash}" ]; then npm ci --no-audit --no-fund >/dev/null && echo ${lockHash} > node_modules/.lock-hash; fi`,
  sandboxUp ? `node scripts/docker-proxy.mjs ${PORT} ${SANDBOX} & sleep 0.5` : "true",
  quoted,
].join("\n");

// Never a window: no display to reach (WSLg would show it on the desktop).
const args = ["run", "--rm", "--init", "-v", `${root}:/work`, "-v", "moodle-driver-node-modules:/work/node_modules", "-w", "/work", "-e", "CI=1"];
args.push("-e", "DISPLAY=", "-e", "WAYLAND_DISPLAY=");
// npm's cache outlives the container: `npx` tools (the Inspector) download once, not on every run.
args.push("-v", "moodle-mcp-npm-cache:/root/.npm");
if (sandboxUp) args.push("--network", NETWORK);
for (const mount of (process.env.MOODLE_DRIVER_DOCKER_MOUNT ?? "").split("\n").filter(Boolean)) args.push("-v", mount);
args.push(IMAGE, "bash", "-c", script);

const result = spawnSync("docker", args, { stdio: "inherit" });
process.exit(result.status ?? 1);

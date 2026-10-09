import assert from "node:assert/strict";
import { once } from "node:events";
import { describe, it } from "node:test";
import { killTree, spawnTree } from "../src/chromiumInstaller.js";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  return !alive(pid);
}

// A parent that starts a child of its own and prints its pid, as Playwright's CLI does to download.
const PARENT = `const c = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(c.pid); setInterval(() => {}, 1000);`;

describe("killTree", () => {
  it("ends a spawned process and the process it started", async () => {
    const parent = spawnTree(process.execPath, ["-e", PARENT]);
    const [line] = (await once(parent.stdout!, "data")) as [Buffer];
    const grandchild = Number(line.toString().trim());
    killTree(parent.pid!);
    assert.equal(await gone(parent.pid!), true);
    assert.equal(await gone(grandchild), true);
  });
});

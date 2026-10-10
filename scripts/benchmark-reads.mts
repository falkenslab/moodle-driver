// Times how the driver reads a real Moodle (ADR-011): AJAX services through a tab against over HTTP,
// and pages three ways (a full tab, a tab without subresources, HTTP with the HTML parsed in a blank
// tab). Run in Docker against a logged-in profile; it only reads. Prints a Markdown table.
//
//   node scripts/in-docker.mjs npx tsx scripts/benchmark-reads.mts <site> <profileDir> <courseId> [runs]
import type { BrowserContext, Page } from "playwright-core";
import { createBrowserManager } from "../src/index.js";
import { callService, fetchSitePage, openSitePage } from "../src/internals.js";
import { courseStructure } from "../src/areas/courses/structure.js";

const [site, profileDir, courseArg, runsArg] = process.argv.slice(2);
if (!site || !profileDir || !courseArg) throw new Error("Usage: benchmark-reads.mts <site> <profileDir> <courseId> [runs]");
const courseId = Number(courseArg);
const runs = Number(runsArg ?? 5);

const browser = createBrowserManager({ profileDir, channel: "chromium", headless: true, downloadBrowser: false });
const context = await browser.context();

async function time(fn: () => Promise<unknown>): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    out.push(performance.now() - start);
  }
  return out;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const ms = (x: number) => `${Math.round(x)} ms`;

// The way services went before: fetch from a kept logged-in tab.
let keptTab: Page | undefined;
async function serviceFromTab(methodname: string, args: object) {
  keptTab ??= await openSitePage(context, site, "user/preferences.php", { follow: false });
  return keptTab.evaluate(
    async ({ methodname, args }) => {
      const g = globalThis as unknown as { M: { cfg: { wwwroot: string; sesskey: string } }; fetch(u: string, i: object): Promise<{ text(): Promise<string> }> };
      const response = await g.fetch(`${g.M.cfg.wwwroot}/lib/ajax/service.php?sesskey=${g.M.cfg.sesskey}&info=${methodname}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      });
      return response.text();
    },
    { methodname, args },
  );
}

// Pages: what each way costs to have the page's DOM ready to read (the readers are the same).
async function fullTab(path: string) {
  const page = await openSitePage(context, site, path, { follow: false });
  await page.close();
}
async function liteTab(path: string) {
  const page = await context.newPage();
  await page.route("**/*", (route) => (["document", "xhr", "fetch"].includes(route.request().resourceType()) ? route.fallback() : route.abort()));
  await page.goto(new URL(path, site).href, { waitUntil: "domcontentloaded" });
  await page.close();
}
let parser: Page | undefined;
async function httpParsed(ctx: BrowserContext, path: string) {
  const { url, html } = await fetchSitePage(ctx, site, path, { follow: false });
  parser ??= await ctx.newPage();
  await parser.route("**/*", (route) => route.abort());
  const clean = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<head>/i, `<head><base href="${url}">`);
  await parser.setContent(clean, { waitUntil: "domcontentloaded" });
}

const sections = await courseStructure(context, site, courseId);
const firstOf = (type: string) => sections.flatMap((s) => s.activities).find((a) => a.type === type)?.id;
const pages: [string, string][] = [
  ["course page (activity details)", `course/view.php?id=${courseId}`],
  ["user grade report (myGrades)", `grade/report/user/index.php?id=${courseId}`],
];
for (const [type, path] of [["quiz", "mod/quiz/view.php?id="], ["forum", "mod/forum/view.php?id="], ["assign", "mod/assign/view.php?id="]] as const) {
  const id = firstOf(type);
  if (id) pages.push([`${type} page`, `${path}${id}`]);
}

const rows: string[] = ["| Read | Before | After | Faster |", "| --- | --- | --- | --- |"];
const service = ["core_course_get_enrolled_courses_by_timeline_classification", { classification: "inprogress" }] as const;
await serviceFromTab(...service);
await callService(context, site, ...service);
const tab = median(await time(() => serviceFromTab(...service)));
const http = median(await time(() => callService(context, site, ...service)));
rows.push(`| AJAX service (\`${service[0]}\`) | ${ms(tab)} (tab) | ${ms(http)} (HTTP) | ×${(tab / http).toFixed(1)} |`);

const pageRows: string[] = ["| Page | Full tab | Tab without subresources | HTTP, parsed in a blank tab |", "| --- | --- | --- | --- |"];
for (const [label, path] of pages) {
  await fullTab(path);
  const a = median(await time(() => fullTab(path)));
  const b = median(await time(() => liteTab(path)));
  const c = median(await time(() => httpParsed(context, path)));
  pageRows.push(`| ${label} | ${ms(a)} | ${ms(b)} (×${(a / b).toFixed(1)}) | ${ms(c)} (×${(a / c).toFixed(1)}) |`);
}
console.log(`Medians of ${runs} runs, warm, against ${site}\n`);
console.log(rows.join("\n"));
console.log("");
console.log(pageRows.join("\n"));
await browser.close();

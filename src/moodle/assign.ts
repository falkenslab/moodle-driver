import type { BrowserContext, Page } from "playwright-core";
import { callService } from "./ajax.js";
import { setFields, type FieldValue } from "./forms.js";
import { openSitePage } from "./session.js";

/** An assignment's ids beyond its course module id, which only the grader page shows. */
export interface AssignmentIds {
  instanceId: number;
  contextId: number;
}

/** The id isn't an assignment's course module, or the person can't grade it. */
export class NotAnAssignmentError extends Error {
  override name = "NotAnAssignmentError";
}

// Ids never change for a course module: one grader page per assignment and site, for the process.
const idCache = new Map<string, AssignmentIds>();

/** Reads `data-assignmentid` and `data-contextid` from a page (the grader's), or `undefined`. */
export function readAssignmentIds(page: Page): Promise<AssignmentIds | undefined> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } };
    const element = g.document.querySelector("[data-assignmentid][data-contextid]");
    const instanceId = Number(element?.getAttribute("data-assignmentid"));
    const contextId = Number(element?.getAttribute("data-contextid"));
    return instanceId > 0 && contextId > 0 ? { instanceId, contextId } : undefined;
  });
}

export async function assignmentIds(context: BrowserContext, siteUrl: string, cmid: number): Promise<AssignmentIds> {
  const key = `${siteUrl}|${cmid}`;
  const cached = idCache.get(key);
  if (cached) return cached;
  const page = await openSitePage(context, siteUrl, `mod/assign/view.php?id=${cmid}&action=grader`);
  try {
    const ids = await readAssignmentIds(page);
    if (!ids) throw new NotAnAssignmentError(`Activity ${cmid} isn't an assignment you can grade (its grader page has no assignment). Take the id of an assignment (module "assign").`);
    idCache.set(key, ids);
    return ids;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A participant as `mod_assign_list_participants` returns it (Moodle 5.2), the fields read. */
export interface MoodleParticipant {
  id: number;
  fullname: string;
  submitted: boolean;
  requiregrading: boolean;
  grantedextension: boolean;
  submissionstatus: string;
}

/** The dates `mod_assign_get_participant` gives for one participant (Unix seconds; 0 is none). */
export interface MoodleParticipantDates {
  allowsubmissionsfromdate: number;
  duedate: number;
  cutoffdate: number;
}

export function listParticipants(context: BrowserContext, siteUrl: string, instanceId: number): Promise<MoodleParticipant[]> {
  return callService(context, siteUrl, "mod_assign_list_participants", {
    assignid: instanceId,
    groupid: 0,
    filter: "",
    skip: 0,
    limit: 0,
    onlyids: false,
    includeenrolments: false,
    tablesort: false,
  });
}

export function participantDates(context: BrowserContext, siteUrl: string, instanceId: number, userId: number): Promise<MoodleParticipantDates> {
  return callService(context, siteUrl, "mod_assign_get_participant", { assignid: instanceId, userid: userId, embeduser: false });
}

/** One submission plugin's content: its text, paragraphs kept, and its files. */
export interface PluginContent {
  plugin: string;
  text: string;
  files: { name: string; url: string }[];
}

/**
 * The content of a submission as the grader's panel renders it: per plugin, the full block
 * (`.full_assignsubmission_<plugin>_<sid>`) or, for content short enough to have none, the summary
 * one. Parsed in the page, by class only (ADR-004). The comments plugin isn't the submission.
 */
export function readSubmissionContent(page: Page, html: string): Promise<PluginContent[]> {
  return page.evaluate((html) => {
    interface Node {
      nodeType: number;
      nodeName: string;
      textContent: string | null;
      childNodes: ArrayLike<Node>;
    }
    interface Element extends Node {
      className: string;
      getAttribute(name: string): string | null;
      querySelectorAll(selector: string): ArrayLike<Element & { remove(): void }>;
    }
    const g = globalThis as unknown as { DOMParser: new () => { parseFromString(html: string, type: string): { querySelectorAll(s: string): ArrayLike<Element> } } };
    const doc = new g.DOMParser().parseFromString(html, "text/html");

    const BLOCKS = new Set(["P", "DIV", "LI", "UL", "OL", "TR", "TABLE", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6"]);
    const found = new Map<string, { plugin: string; full?: Element; summary?: Element }>();
    for (const element of Array.from(doc.querySelectorAll('[class*="assignsubmission_"]'))) {
      const match = /\b(full|summary)_assignsubmission_([a-z0-9]+)_(\d+)\b/.exec(element.className);
      if (!match || match[2] === "comments") continue;
      const key = `${match[2]}_${match[3]}`;
      const entry = found.get(key) ?? { plugin: match[2]! };
      entry[match[1] as "full" | "summary"] = element;
      found.set(key, entry);
    }

    return Array.from(found.values()).map(({ plugin, full, summary }) => {
      const block = (full ?? summary)!;
      for (const control of Array.from(block.querySelectorAll(".expandsummaryicon, script, style"))) control.remove();
      const files = Array.from(block.querySelectorAll('a[href*="pluginfile.php"]')).map((a) => ({ name: (a.textContent ?? "").trim(), url: a.getAttribute("href") ?? "" }));
      // Depth first with a stack, not a named recursive function: tsx's keepNames would wrap it in a
      // `__name` helper the page doesn't have (confirmed empirically).
      let raw = "";
      const stack: (Node | string)[] = [block];
      while (stack.length > 0) {
        const item = stack.pop()!;
        if (typeof item === "string") raw += item;
        else if (item.nodeType === 3) raw += (item.textContent ?? "").replace(/\s+/g, " ");
        else if (item.nodeName === "BR") raw += "\n";
        else if (item.nodeName === "PRE") raw += `\n${item.textContent ?? ""}\n`;
        else {
          const isBlock = BLOCKS.has(item.nodeName);
          raw += item.nodeName === "LI" ? "\n- " : isBlock ? "\n" : "";
          // A list item ends where the next one starts: no blank line between items.
          stack.push(isBlock && item.nodeName !== "LI" ? "\n" : "", ...Array.from(item.childNodes).reverse());
        }
      }
      const text = raw
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n- +/g, "\n- ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return { plugin, text, files };
    });
  }, html);
}

/** The grader panel's HTML for one participant: their current submission and grade form. */
export async function gradingPanelHtml(context: BrowserContext, siteUrl: string, contextId: number, userId: number): Promise<string> {
  const fragment = await callService<{ html: string }>(context, siteUrl, "core_get_fragment", {
    component: "mod_assign",
    callback: "gradingpanel",
    contextid: contextId,
    args: [
      { name: "userid", value: String(userId) },
      { name: "attemptnumber", value: "-1" },
      { name: "jsonformdata", value: '""' },
    ],
  });
  return fragment.html;
}

/** Moodle's grader didn't take the grade. */
export class GradingError extends Error {
  override name = "GradingError";
}

/**
 * Fills the grading panel's form for one participant in `page` (a blank tab), and returns it
 * serialized as the grader does (`form.serialize()`), ready for `mod_assign_submit_grading_form`.
 */
export async function fillGradingForm(page: Page, panelHtml: string, fields: Record<string, FieldValue>): Promise<string> {
  await page.setContent(panelHtml);
  await setFields(page, fields);
  return page.evaluate(() => {
    const g = globalThis as unknown as {
      document: { querySelector(s: string): unknown };
      FormData: new (form: unknown) => Iterable<[string, string]>;
      URLSearchParams: new (init: Iterable<[string, string]>) => { toString(): string };
    };
    return new g.URLSearchParams(new g.FormData(g.document.querySelector("form.gradeform"))).toString();
  });
}

/** The grade and feedback currently in a grading panel, if any. */
export async function panelGrade(page: Page, panelHtml: string): Promise<{ grade?: string; feedback?: string }> {
  await page.setContent(panelHtml);
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document;
    const grade = doc.querySelector('form.gradeform [name="grade"]')?.value;
    const feedback = doc.querySelector('form.gradeform [name="assignfeedbackcomments_editor[text]"]')?.value;
    return { grade: grade || undefined, feedback: feedback || undefined };
  });
}

/** Submits a serialized grading form; Moodle answers warnings when it refuses it. */
export async function submitGradingForm(context: BrowserContext, siteUrl: string, instanceId: number, userId: number, serialized: string): Promise<void> {
  const warnings = await callService<{ message?: string; warningcode?: string }[]>(context, siteUrl, "mod_assign_submit_grading_form", {
    assignmentid: instanceId,
    userid: userId,
    jsonformdata: JSON.stringify(serialized),
  });
  if (warnings.length > 0) {
    // Moodle's form messages don't reach the service's warnings: a grade out of range only says it couldn't save.
    throw new GradingError(`Moodle didn't save the grade: ${warnings.map((w) => w.message ?? w.warningcode).join("; ")} Check the grade is within the assignment's range or scale, and the fields' names.`);
  }
}

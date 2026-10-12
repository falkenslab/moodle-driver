// Files embedded in rich text: what a person does inserting an image in Moodle's editor. Each
// editor (`<field>[text]`) has its own draft area (`<field>[itemid]`); the editor uploads the file
// there and writes its draft URL into the HTML, which Moodle turns into @@PLUGINFILE@@ on saving.
import path from "node:path";
import type { Page } from "playwright-core";
import { checkLocalFiles } from "./files.js";
import { formValue, uploadToDraft, type FieldValue } from "./forms.js";
import { MoodleError } from "./errors.js";
import { decodeEntities } from "./text.js";

// A src or href attribute, quoted: its start, the quote and the value.
const ATTRIBUTE = /(\s(?:src|href)\s*=\s*)(["'])(.*?)\2/gis;

/** An attribute's value as a name: entities decoded, then the URL's escapes (`my%20shot.png`). */
function nameOf(value: string): string {
  const decoded = decodeEntities(value).trim();
  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded;
  }
}

/** A reference to a file next to the text, not a URL: no scheme, not from the site's root, not an anchor, not a file Moodle already keeps. */
function isLocalName(name: string): boolean {
  return name !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(name) && !/^[/#?]/.test(name) && !name.startsWith("@@PLUGINFILE@@");
}

/** The local names (`shot.png`) the `src` and `href` attributes of `html` use. */
export function localNames(html: string): string[] {
  return [...html.matchAll(ATTRIBUTE)].map((match) => nameOf(match[3]!)).filter(isLocalName);
}

/** The rich texts among a form's values: the `<editor>[text]` fields, by editor. */
function richTexts(values: Record<string, FieldValue>): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [name, value] of Object.entries(values)) {
    const editor = /^(.+)\[text\]$/.exec(name)?.[1];
    if (editor && typeof value === "string") texts.set(editor, value);
  }
  return texts;
}

/** The HTML of the editors (`<editor>[text]`) among a form's values, for `checkEmbeds`. */
export function editorTexts(values: Record<string, FieldValue>): string[] {
  return [...richTexts(values).values()];
}

/**
 * Checks files to embed against the HTML that uses them, before anything is sent: absolute local
 * paths that exist, one per name, each used by a `src` or `href` of the texts (`<img src="shot.png">`),
 * and every local name the texts use given as a file.
 */
export async function checkEmbeds(texts: (string | undefined)[], files: string[]): Promise<void> {
  await checkLocalFiles(files);
  const names = files.map((file) => path.basename(file));
  const twice = names.filter((name, i) => names.indexOf(name) !== i);
  if (twice.length > 0) throw new MoodleError(`Two files to embed have the same name: ${[...new Set(twice)].join(", ")}. The HTML names each by its file name.`, "invalid-input");
  const used = new Set(texts.flatMap((html) => (html === undefined ? [] : localNames(html))));
  const unused = names.filter((name) => !used.has(name));
  if (unused.length > 0) throw new MoodleError(`No text uses ${unused.map((name) => `"${name}"`).join(", ")}: name each file to embed in a src or href (<img src="${unused[0]}">).`, "invalid-input");
  const missing = [...used].filter((name) => !names.includes(name));
  if (missing.length > 0) throw new MoodleError(`The text uses ${missing.map((name) => `"${name}"`).join(", ")}, but no file of that name is given to embed. Give its local path in embed, or a full URL.`, "invalid-input");
}

/**
 * Embeds `files` (checked with `checkEmbeds` first) in the rich texts among `values`, in the open
 * form `page`: each file is uploaded to the draft area of every editor whose HTML names it, and the
 * `src` and `href` naming it are rewritten to its draft URL, in `values` itself. Throws when an editor
 * that uses a file has no draft area in the form (it takes no files).
 */
export async function embedFiles(page: Page, values: Record<string, FieldValue>, files: string[]): Promise<void> {
  if (files.length === 0) return;
  const byName = new Map(files.map((file) => [path.basename(file), file]));
  for (const [editor, html] of richTexts(values)) {
    const names = [...new Set(localNames(html))].filter((name) => byName.has(name));
    if (names.length === 0) continue;
    const draft = await formValue(page, `${editor}[itemid]`);
    if (!draft) throw new MoodleError(`The form's ${editor} editor takes no files, so nothing can be embedded in it.`, "not-available");
    // Overwritten: a file of the same name the text had before is replaced, and its URL stays.
    const urls = await uploadToDraft(page, draft, names.map((name) => byName.get(name)!), { overwrite: true });
    const urlOf = new Map(names.map((name, i) => [name, urls[i]!]));
    values[`${editor}[text]`] = html.replace(ATTRIBUTE, (whole, start: string, quote: string, value: string) => {
      const url = urlOf.get(nameOf(value));
      return url ? `${start}${quote}${url}${quote}` : whole;
    });
  }
}

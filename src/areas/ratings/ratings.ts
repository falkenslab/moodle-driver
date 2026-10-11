// Ratings on forum posts, glossary entries and database records: the rating form Moodle renders under
// each rateable item (form.postratingform, its hidden fields and its `rating` menu), sent to
// rating/rate_ajax.php as the page's own script does.
import type { BrowserContext } from "playwright-core";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { GradingError } from "../assignments/grader.js";

/** Something rated: a forum post (in its discussion), a glossary entry, or a database record. */
export type RateableItem = { type: "forum-post"; id: number; discussionId: number } | { type: "glossary-entry"; id: number } | { type: "database-record"; id: number };

/** The page that shows an item with its rating form. */
function itemPage(item: RateableItem): string {
  switch (item.type) {
    case "forum-post":
      return `mod/forum/discuss.php?d=${item.discussionId}`;
    case "glossary-entry":
      return `mod/glossary/showentry.php?eid=${item.id}`;
    case "database-record":
      return `mod/data/view.php?rid=${item.id}`;
    default:
      throw new MoodleError(`Ratings are on forum posts, glossary entries and database records, not "${(item as { type: string }).type}".`, "invalid-input");
  }
}

/** Moodle's "Rate..." option: no rating (RATING_UNSET_RATING). */
const UNSET = "-999";

/**
 * Rates a forum post, a glossary entry or a database record as the person, as the rating menu under
 * it does: by a scale item's name, or its number (the points of a point scale). `null` takes the
 * person's rating away. Returns a sentence of what changed and the item's aggregate afterwards (as
 * Moodle shows it, by the activity's aggregation) with the number of ratings. Throws `GradingError`
 * when the item has no rating menu for the person (ratings off, their own item, outside the
 * rating period, or no permission) or the rating isn't on its scale.
 */
export async function rate(context: BrowserContext, siteUrl: string, item: RateableItem, rating: number | string | null): Promise<{ changed: string; aggregate?: string; count?: number }> {
  const page = await openSitePage(context, siteUrl, itemPage(item));
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new GradingError(`You can't see ${item.type} ${item.id}: ${refused}`);
    const form = await page.evaluate((itemId) => {
      interface El {
        name: string;
        value: string;
        text: string;
        querySelectorAll(s: string): ArrayLike<El>;
        querySelector(s: string): El | null;
      }
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<El> } }).document;
      const found = Array.from(doc.querySelectorAll("form.postratingform")).find((f) => f.querySelector(`input[name="itemid"][value="${itemId}"]`) !== null);
      if (!found) return undefined;
      return {
        fields: Array.from(found.querySelectorAll('input[type="hidden"]')).map((input): [string, string] => [input.name, input.value]),
        options: Array.from(found.querySelectorAll('select[name="rating"] option')).map((o) => ({ value: o.value, text: o.text.replace(/\s+/g, " ").trim() })),
      };
    }, item.id);
    if (!form || form.options.length === 0) {
      throw new GradingError(`${item.type} ${item.id} has no rating menu for you: its activity doesn't use ratings, it's your own, the rating period is over, or you aren't allowed to rate.`);
    }
    let value: string;
    if (rating === null) value = UNSET;
    else {
      const option = form.options.find((o) => o.value !== UNSET && (o.value === String(rating) || o.text === String(rating)));
      if (!option) throw new GradingError(`${item.type} ${item.id} is rated on ${form.options.filter((o) => o.value !== UNSET).map((o) => `"${o.text}"`).join(", ")}; not "${rating}".`);
      value = option.value;
    }
    const body = new URLSearchParams([...form.fields.filter(([name]) => name !== "returnurl"), ["rating", value]]).toString();
    const answer = await page.evaluate(
      async ({ body }) => {
        const g = globalThis as unknown as { M: { cfg: { wwwroot: string } }; fetch(url: string, init: object): Promise<{ text(): Promise<string> }> };
        const response = await g.fetch(`${g.M.cfg.wwwroot}/rating/rate_ajax.php`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          credentials: "same-origin",
        });
        return response.text();
      },
      { body },
    );
    let result: { success?: boolean; error?: string; aggregate?: string | number; count?: number | string };
    try {
      result = JSON.parse(answer) as typeof result;
    } catch {
      throw new GradingError(`Moodle didn't take the rating on ${item.type} ${item.id}: you may not be allowed to rate it.`);
    }
    if (!result.success) throw new GradingError(`Moodle didn't take the rating on ${item.type} ${item.id}: ${result.error ?? "no reason given"}.`);
    const shown = rating === null ? undefined : form.options.find((o) => o.value === value)?.text;
    // Without ratings left, Moodle answers " - " for the aggregate.
    const aggregate = String(result.aggregate ?? "").trim();
    const count = Number(result.count);
    return {
      changed: rating === null ? `Rating on ${item.type} ${item.id} taken away.` : `Rated ${item.type} ${item.id} "${shown}".`,
      ...(aggregate !== "" && aggregate !== "-" ? { aggregate } : {}),
      ...(Number.isFinite(count) && result.count !== undefined && result.count !== "" ? { count } : {}),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

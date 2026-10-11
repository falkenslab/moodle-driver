// Dates as Moodle's reports show them: text written with one of the site language's strftime formats
// (`strftimedatetimeaccurate`…, `core_langconfig`), month names from ICU in the language's locale, in
// the person's time zone. Read back by that format, so they come as instants in any language.
import type { BrowserContext } from "playwright-core";
import { callService } from "../../core/ajax.js";

/** How a report writes a date: the strftime format, the language's locale (`es_ES.UTF-8`) and the person's time zone. */
export interface DateFormat {
  format: string;
  locale: string;
  timeZone: string;
}

/** The language's formats by their `core_langconfig` names, and its locale, through `core_get_strings`. */
export async function languageFormats(context: BrowserContext, siteUrl: string, names: string[]): Promise<{ formats: Record<string, string>; locale: string }> {
  const strings = await callService<{ stringid: string; string: string }[]>(context, siteUrl, "core_get_strings", {
    strings: [...names, "locale"].map((stringid) => ({ stringid, component: "langconfig" })),
  });
  const formats: Record<string, string> = {};
  for (const { stringid, string } of strings) formats[stringid] = string;
  return { formats, locale: formats.locale ?? "en" };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ.]/g, "").toLowerCase().trim();

/** The month names ICU gives in `locale` (`es_ES.UTF-8` or `es-ES`), as a date with its day writes them. */
function monthNames(locale: string, month: "long" | "short"): string[] {
  const tag = locale.replace(/[.@].*$/, "").replace("_", "-");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(tag, { month, day: "numeric", timeZone: "UTC" });
  } catch {
    formatter = new Intl.DateTimeFormat("en", { month, day: "numeric", timeZone: "UTC" });
  }
  return Array.from({ length: 12 }, (_, m) => formatter.formatToParts(new Date(Date.UTC(2020, m, 15))).find((part) => part.type === "month")?.value ?? "");
}

/**
 * The instant a date text stands for, read with the format Moodle wrote it with; undefined when the
 * text doesn't follow it. Only the start of the text is read: Moodle may add more after the date
 * ("(3 hours 4 mins)").
 */
export function parseMoodleDate(text: string, { format, locale, timeZone }: DateFormat): Date | undefined {
  const fields: string[] = [];
  let pattern = "";
  for (const piece of format.split(/(%[a-zA-Z%])/)) {
    if (piece === "") continue;
    const token = /^%([a-zA-Z%])$/.exec(piece)?.[1];
    if (token === undefined) {
      pattern += piece.split(/\s+/).map(escape).join("\\s+");
      continue;
    }
    const group = (name: string, regex: string) => {
      fields.push(name);
      return `(${regex})`;
    };
    switch (token) {
      case "d":
      case "e":
        pattern += group("day", "\\d{1,2}");
        break;
      case "m":
        pattern += group("month", "\\d{1,2}");
        break;
      case "B":
      case "b":
      case "h":
        pattern += group(token === "B" ? "monthName" : "monthShort", "[^\\s\\d,]+");
        break;
      case "Y":
        pattern += group("year", "\\d{4}");
        break;
      case "y":
        pattern += group("year2", "\\d{2}");
        break;
      case "H":
      case "k":
        pattern += group("hour", "\\d{1,2}");
        break;
      case "I":
      case "l":
        pattern += group("hour12", "\\d{1,2}");
        break;
      case "M":
        pattern += group("minute", "\\d{2}");
        break;
      case "S":
        pattern += group("second", "\\d{2}");
        break;
      case "p":
      case "P":
        // PHP's own AM and PM, in English whatever the language.
        pattern += group("meridiem", "[AaPp][Mm]");
        break;
      case "%":
        pattern += "%";
        break;
      default:
        // A weekday's name, or anything else that doesn't make the date.
        pattern += "\\S+?";
    }
  }
  const match = new RegExp(`^\\s*${pattern}`, "u").exec(text.replace(/\s+/g, " "));
  if (!match) return undefined;
  const value = (name: string) => {
    const i = fields.indexOf(name);
    return i < 0 ? undefined : match[i + 1];
  };
  const named = value("monthName") ?? value("monthShort");
  let month = value("month") !== undefined ? Number(value("month")) : undefined;
  if (named !== undefined) {
    const names = monthNames(locale, value("monthName") !== undefined ? "long" : "short").map(fold);
    const found = names.indexOf(fold(named));
    month = found >= 0 ? found + 1 : undefined;
  }
  const year = value("year") !== undefined ? Number(value("year")) : value("year2") !== undefined ? 2000 + Number(value("year2")) : undefined;
  const day = Number(value("day"));
  if (!month || !year || !day) return undefined;
  let hour = Number(value("hour") ?? 0);
  if (value("hour12") !== undefined) hour = (Number(value("hour12")) % 12) + (/^p/i.test(value("meridiem") ?? "") ? 12 : 0);
  const wall = Date.UTC(year, month - 1, day, hour, Number(value("minute") ?? 0), Number(value("second") ?? 0));
  return new Date(wall - zoneOffset(wall, timeZone));
}

/** How far ahead of UTC `timeZone`'s clocks are at the wall time `wall` (twice, across a DST change). */
function zoneOffset(wall: number, timeZone: string): number {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
  } catch {
    return 0;
  }
  let time = wall;
  for (let i = 0; i < 2; i++) {
    const parts = formatter.formatToParts(new Date(time));
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const shown = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    time += wall - shown;
  }
  return wall - time;
}

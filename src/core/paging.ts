// Long lists a page at a time, the same way in every function that pages them: `limit` and `offset`
// counted in the function's own items, in its own order; without `limit` the whole list as before,
// with it `{ items, more }`. Each function only says how to fetch the items of a window from Moodle.
import { MoodleError } from "./errors.js";

/** How much of a long list to read: at most `limit` items, after skipping `offset`. */
export interface PageOptions {
  /** How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. */
  limit?: number;
  /** How many items to skip first, in the function's own order: 0 unless given. */
  offset?: number;
}

/** One page of a long list: its items, and whether there are more after them (ask again with `offset` moved by `limit`). */
export interface ListPage<T> {
  items: T[];
  /** Whether a page after this one has something. */
  more: boolean;
}

/** A function's options with a `limit`: the call gives a `ListPage`. */
export type WithLimit<O> = O & { limit: number };
/** A function's options without a `limit`: the call gives the whole list, as without paging. */
export type WithoutLimit<O> = O & { limit?: undefined };

/** What a function fetches for a page: the items from `offset` on, at most `count` of them (every one when undefined). */
export interface PageWindow {
  offset: number;
  count?: number;
}

/**
 * The window a call's options ask for: `limit` + 1 items (the one more tells whether there are more),
 * from `offset`. Refuses a `limit` below 1 or an `offset` below 0 (`invalid-input`).
 */
export function pageWindow({ limit, offset = 0 }: PageOptions): PageWindow {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new MoodleError(`limit must be a whole number of 1 or more, not ${limit}: leave it out for every item.`, "invalid-input");
  if (!Number.isInteger(offset) || offset < 0) throw new MoodleError(`offset must be a whole number of 0 or more, not ${offset}.`, "invalid-input");
  return limit === undefined ? { offset } : { offset, count: limit + 1 };
}

/** The items of a window fetched for `limit`, shaped as the convention says: the list without `limit`, `{ items, more }` with it. */
export function toPage<T>(found: T[], limit: number | undefined): T[] | ListPage<T> {
  return limit === undefined ? found : { items: found.slice(0, limit), more: found.length > limit };
}

/**
 * Fetches the window the options ask for and shapes it (`toPage`): what every paged function does,
 * saying only how to fetch a window's items, ideally asking Moodle for no more than them.
 */
export async function paged<T>(options: PageOptions, fetch: (window: PageWindow) => Promise<T[]>): Promise<T[] | ListPage<T>> {
  const window = pageWindow(options);
  return toPage(await fetch(window), options.limit);
}

/** Turns a list or a page's items into others (raw Moodle items into the driver's, only those returned), keeping its shape. */
export async function mapItems<T, U>(list: T[] | ListPage<T>, map: (items: T[]) => U[] | Promise<U[]>): Promise<U[] | ListPage<U>> {
  return Array.isArray(list) ? map(list) : { items: await map(list.items), more: list.more };
}

/** A window's items out of a whole list, for what Moodle can't page: the list is read in full and cut. */
export function sliceWindow<T>(all: T[], { offset, count }: PageWindow): T[] {
  return all.slice(offset, count === undefined ? undefined : offset + count);
}

/**
 * For a list Moodle pages by number and size (`page=index`, `perpage=size`): the smallest size whose
 * one page holds the whole window, the page's index, and how many of its items come before the
 * window. One request instead of every page before it.
 */
export function numberedPage({ offset, count }: PageWindow & { count: number }): { size: number; index: number; skip: number } {
  let size = Math.max(count, 1);
  while (Math.floor(offset / size) !== Math.floor((offset + count - 1) / size)) size++;
  const index = Math.floor(offset / size);
  return { size, index, skip: offset - index * size };
}

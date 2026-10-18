# Wikis

Wiki activities (module `wiki`), as participants and teachers use them: a subwiki's pages listed, a page read with its links and history, new pages created and pages edited, whole or by section. Create the wiki itself with `createActivity({ type: "wiki", … })` (see [Activities and sections](activities.md)), with its settings by their form names (`wikimode: "collaborative"` or `"individual"`, `firstpagetitle`, `defaultformat`…).

**Terms:** [wiki](../reference/glossary.md#wiki), [course module id](../reference/glossary.md#course-module-id).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

None of Moodle's wiki services is open to AJAX (they are the mobile app's): the driver reads the wiki's own pages, the page list and the links in its map, each page's view and history, and writes through the new page form and the page editor, read by their links, fields and classes, so it works in any interface language, on Moodle 4.5 (Boost or Classic) as on 5.x. Every function throws `NotAWikiError` when the id isn't a wiki the person can open, `WikiError` when Moodle refuses (with Moodle's message and the capability it takes) and `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

A wiki keeps its pages in subwikis: a collaborative wiki has one for everyone, or one per group in a wiki with groups; an individual wiki has one per participant. The functions work on the person's subwiki (the wiki's, their group's, or their own) unless `groupId` or `userId` choose another, as the wiki's group or participant menu does: choosing a group also makes it the person's current group in the course, as the menu does. A wiki with one subwiki for everyone refuses them with `WikiError`.

## wikiPages

A subwiki's pages, by title.

```ts
function wikiPages(context: BrowserContext, siteUrl: string, activityId: number, options?: WikiPagesOptions): Promise<WikiPageSummary[]>;

interface WikiPagesOptions {
  groupId?: number;
  userId?: number;
  limit?: number;
  offset?: number;
}

interface WikiPageSummary {
  id: number;
  title: string;
  links: WikiLink[];
  version: number;
  modified?: string;
  authorId?: number;
  authorName?: string;
}

interface WikiLink {
  title: string;
  pageId?: number;
}
```

- `links`: the pages it links to, from the wiki's map; a link to a page not created yet has no `pageId` (Moodle shows it as a page to create).
- `version`, `modified`, `authorId` and `authorName`: its latest version, from its history; `modified` to the minute, as the history shows it. A page created but never saved is version 0, with no author.
- Empty while the subwiki has no pages: Moodle starts each subwiki with the wiki's first page.
- `limit` and `offset` page the list as every long list does (see [Long lists](../concepts/calling-functions.md#long-lists)); only the pages returned are read beyond the page list, two pages of Moodle each.

## wikiPage

A page with its content.

```ts
function wikiPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, options?: { history?: boolean }): Promise<WikiPage>;

interface WikiPage extends WikiPageSummary {
  subwikiId?: number;
  html: string;
  text: string;
  sections: string[];
  images?: ImageItem[];
  media?: MediaItem[];
  history?: WikiVersion[];
}

interface WikiVersion {
  version: number;
  modified?: string;
  authorId: number;
  authorName: string;
}
```

- `html`: the content as Moodle renders it (links to other pages as links, images with their URLs on the site), without the table of contents and the "[edit]" links Moodle adds to it; `text`, `images` and `media` as [`activityContent`](content.md) gives them.
- `sections`: the page's headings Moodle edits it by, `editWikiPage`'s `section`.
- `links`: the pages its content links to, as in `wikiPages`.
- With `history`, every version, newest first.
- `WikiError` when the page isn't in the wiki (take its id from `wikiPages`).

## createWikiPage

Creates a page in a subwiki as the person, as following a link to a page not created yet and saving its editor do.

```ts
function createWikiPage(context: BrowserContext, siteUrl: string, activityId: number, input: WikiPageInput): Promise<WikiPageChange>;

interface WikiPageInput {
  title: string;
  content: string;
  groupId?: number;
  userId?: number;
  embed?: string[];
}

interface WikiPageChange {
  changed: string;
  pageId: number;
  page: WikiPage;
}
```

- `content`: HTML in a wiki of HTML pages (Moodle's default), the wiki's markup in a Creole or NWiki one; `[[Title]]` links to another page, created or not. With `embed`, local files (absolute paths) the HTML names by their file names (`<img src="shot.png">`) are uploaded into it, as [`createActivity`](activities.md) embeds them; only in HTML pages.
- A subwiki with no pages yet starts with the wiki's first page, as Moodle starts it: its title must be the wiki's first page title (`WikiError` names it otherwise).
- A title already in the subwiki is refused with `WikiError` (Moodle would open that page instead): change it with `editWikiPage`.
- It takes `mod/wiki:createpage` and `mod/wiki:editpage`, which students have, in a subwiki that is the person's (or any, for teachers).

## editWikiPage

Changes a page's content as its editor does: a new version, by the person.

```ts
function editWikiPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, changes: WikiPageChanges): Promise<WikiPageChange>;

interface WikiPageChanges {
  content: string;
  section?: string;
  embed?: string[];
}
```

- `content` replaces the page's content; with `section` (one of `wikiPage`'s `sections`), only that section's, its heading included, as Moodle's "[edit]" link of the section does.
- Moodle locks a page while someone has it open in its editor. When someone else holds the lock, the driver throws `WikiPageLockedError` and never overrides it, even for a teacher who could: Moodle doesn't say who holds it. The lock ends when they save or leave the editor, or 30 seconds after their editor closes; try again then.
- The driver's own editor takes the lock for the moment of saving, and always leaves through the page's view, which releases it as leaving the editor in Moodle does.
- It takes `mod/wiki:editpage`, in a subwiki that is the person's (or any, for teachers); `WikiError` when the section isn't in the page.

## Example

```ts
// `moodle` is the object from createMoodle(), as in the getting-started pages.
const activityId = 72;

// The wiki's first page, then a page it links to.
const home = await moodle.createWikiPage(activityId, { title: "Home", content: "<p>Start with the [[Rules]].</p>" });
await moodle.createWikiPage(activityId, { title: "Rules", content: "<h3>Be kind</h3><p>Always.</p><h3>Cite</h3><p>Your sources.</p>" });

for (const page of await moodle.wikiPages(activityId)) {
  console.log(`${page.title}: version ${page.version}, by ${page.authorName ?? "nobody yet"}`);
}

const rules = (await moodle.wikiPages(activityId)).find((page) => page.title === "Rules")!;
await moodle.editWikiPage(activityId, rules.id, { section: "Cite", content: "<h3>Cite</h3><p>Your sources, with links.</p>" });
const read = await moodle.wikiPage(activityId, home.pageId, { history: true });
console.log(read.text, read.history?.length);
```

## Data categories

`wikiPages` and `wikiPage` are `course-content` and `others-personal` (pages and their versions carry their authors, often students); `createWikiPage` and `editWikiPage` are `course-content`: a wiki's pages are its shared content, whoever wrote them. See [Data categories](../concepts/data-categories.md).

# External tools

This area works a course's external tools (LTI): listing the tools a course may use (`externalTools`), adding one to the course (`addExternalTool`), showing it in the activity chooser or hiding it from there (`setExternalToolInChooser`), deleting the course's own (`deleteExternalTool`), and giving the person the URL that launches an external tool activity (`externalToolLaunchUrl`). An activity is made from a tool with `createActivity` and the tool's id (see [Building a course](activities.md#createactivity)). Managing tools takes Moodle's LTI capabilities in the course, which editing teachers have by default; launching takes `mod/lti:view`, which every participant has.

**Terms:** [external tool](../reference/glossary.md#external-tool).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## How external tools work in Moodle

A tool is set up before any activity uses it: an administrator sets up site tools (Site administration > Plugins > External tool > Manage tools), which every course may use, and a teacher adds the course's own on the course's "LTI External tools" page (More > LTI External tools, `mod/lti/coursetools.php`). Each has a URL, and the consumer key and shared secret its provider gave. Moodle 5 makes every external tool activity from a tool: the activity no longer holds a URL of its own. A tool shown in the activity chooser is offered there under its own name; one that isn't is offered nowhere on the course's pages, but an activity can still be made from it.

Moodle has no service open to AJAX that lists a course's tools for a teacher: the driver reads the course's tools page, a report builder table, as a teacher would, and adds a tool through the course tool form (`mod/lti/coursetooledit.php`). Showing, hiding and deleting go through the services the page's own toggle and delete action call (`mod_lti_toggle_showinactivitychooser`, `mod_lti_delete_course_tool_type`).

Dynamic registration, where a tool registers itself with Moodle, isn't covered: Moodle 5.2 offers it to administrators only, on the site's tool management page, not on a course's.

## ExternalTool

The tools `externalTools` lists and the writes return:

```ts
interface ExternalTool {
  id: number;
  name: string;
  description: string;
  scope?: "site" | "course";
  url?: string;
  shownInActivityChooser: boolean;
}
```

- `id`: the tool's id (Moodle's tool type id), what `createActivity` takes as `toolId` and the other functions take.
- `description`: plain text, `""` without one.
- `scope`: `"site"` for a tool an administrator set up, which teachers can't change; `"course"` for one added to this course. Moodle locks every row alike for whom can't add course tools, so for them it's absent.
- `url`: a course tool's URL, as its form holds it; a site tool's isn't shown to teachers, so it's absent.
- `shownInActivityChooser`: whether teachers find it in the activity chooser.

A tool's shared secret is never read or returned.

## externalTools

The external tools a course may use, as its "LTI External tools" page lists them: the site's tools and the course's own, by name.

```ts
function externalTools(context: BrowserContext, siteUrl: string, courseId: number): Promise<ExternalTool[]>;
```

The page shows ten tools; the rest, on a course with more, comes from the table's own service (`core_table_get_dynamic_table_content`), as its paging does. A course tool's URL comes from its edit form, fetched without a tab, one request per course tool. Moodle lists only the tools that may be used in the course: site tools restricted to other course categories, and those an administrator set to "Do not show", don't appear.

It throws `ExternalToolError` when the person can't see the course's tools (it takes `mod/lti:addpreconfiguredinstance`).

## addExternalTool

Adds an external tool to a course through Moodle's course tool form, and returns it.

```ts
function addExternalTool(context: BrowserContext, siteUrl: string, courseId: number, tool: NewExternalTool): Promise<{ changed: string; tool: ExternalTool }>;

interface NewExternalTool {
  name: string;
  url: string;
  description?: string;
  key?: string;
  secret?: string;
  settings?: Record<string, FieldValue>;
}
```

- `url`: the tool's launch URL, `http` or `https`, or a cartridge's (an XML file describing the tool, from which Moodle fills in the rest).
- `key`, `secret`: the consumer key and shared secret the tool's provider gave, for an LTI 1.0/1.1 tool. Moodle stores the secret; nothing returns it.
- `settings`: any other field of the form, by its name, and these win: `lti_ltiversion` (`"1.3.0"` for LTI 1.3, which also needs `lti_publickeyset`, `lti_initiatelogin` and `lti_redirectionuris`), `lti_launchcontainer` (2 embed, 3 embed without blocks, 5 existing window, 4 new window), `lti_sendname`, `lti_sendemailaddr`, `lti_acceptgrades`, `lti_customparameters`.

Moodle shows the new tool in the activity chooser. When it saves the form, Moodle fetches the URL to see whether it's a cartridge; a URL its network settings block (localhost, private addresses) is saved as it is (confirmed empirically, Moodle 5.2).

It throws `ExternalToolError` when the person can't add tools to the course (it takes `mod/lti:addcoursetool`), a `MoodleError` with code `invalid-input` for an empty name or a URL that isn't `http(s)`, and `FormError` with Moodle's reason when it refuses the form.

## setExternalToolInChooser

Shows an external tool in the course's activity chooser, or hides it from there, as the toggle on the course's tools page does, and returns the tool afterwards.

```ts
function setExternalToolInChooser(context: BrowserContext, siteUrl: string, courseId: number, toolId: number, shown: boolean): Promise<{ changed: string; tool: ExternalTool }>;
```

For a site tool the setting is the course's own: the site and other courses keep theirs (Moodle keeps it as a per-course record, which it doesn't remove when the tool or the course is deleted). `createActivity` still makes an activity from a hidden tool (confirmed empirically, Moodle 5.2).

It throws `ExternalToolError` when the course doesn't list the tool, and when the person can't change the course's tools (it takes `mod/lti:addcoursetool`).

## deleteExternalTool

Deletes one of the course's own external tools, as the delete action on the course's tools page does.

```ts
function deleteExternalTool(context: BrowserContext, siteUrl: string, courseId: number, toolId: number): Promise<{ changed: string }>;
```

The activities made from it stay in the course, but can't be launched any more: Moodle's page warns with how many use it, and the driver doesn't ask. Deleting a course doesn't delete its tools (Moodle 5.2): delete them first when they're no longer needed.

It throws `ExternalToolError` when the course doesn't list the tool, for a site tool (only an administrator deletes it), and when the person can't change the course's tools (it takes `mod/lti:addcoursetool`).

## externalToolLaunchUrl

The URL that launches an external tool activity for the person, `mod/lti/launch.php?id=<activityId>`, for the person to open in their browser.

```ts
function externalToolLaunchUrl(context: BrowserContext, siteUrl: string, activityId: number): Promise<string>;
```

Opening the URL logs the view, as opening the activity does, and sends the person to the tool with their signed launch. To check that the person may launch it and that it is an external tool, the driver reads Moodle's launch page once over HTTP, without logging a view: the page is a form the browser would post to the tool, and the driver never posts it, so nothing reaches the tool. Moodle signs each launch when it's opened, so the URL is what to keep, not the launch.

It throws `ExternalToolError` with Moodle's message when the activity isn't an external tool or the person can't launch it (it takes `mod/lti:view`).

## Example

A teacher adds a simulator the school pays for to a course, keeps it out of the activity chooser, makes an activity from it and gives a student the link.

```ts
import { ExternalToolError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const { tool } = await moodle.addExternalTool(3, { name: "Circuit simulator", url: "https://sim.example.edu/lti", key: "school-42", secret: "from-the-provider" });
  await moodle.setExternalToolInChooser(3, tool.id, false);

  const { activityId } = await moodle.createActivity({ courseId: 3, sectionId: 12, type: "lti", toolId: tool.id, name: "Build a circuit", visibility: "shown" });

  for (const t of await moodle.externalTools(3)) console.log(t.id, t.name, t.scope, t.shownInActivityChooser);
  console.log(await moodle.externalToolLaunchUrl(activityId!));
} catch (error) {
  if (error instanceof ExternalToolError) console.log(error.message);
  else throw error;
}
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `externalTools`, `addExternalTool`, `setExternalToolInChooser`, `deleteExternalTool`: `course-content` (what teachers set up; a tool's secret is never returned).
- `externalToolLaunchUrl`: `own` (the person's own launch).
